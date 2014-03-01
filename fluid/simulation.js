if (typeof this.performance === 'undefined') {
  this.performance = {};
}
if (!this.performance.now){
  var nowOffset = Date.now();
  this.performance.now = function now(){
    //return 0;
    return Date.now() - nowOffset;
  }
}

var sharedMemorySupported = new ArrayBuffer(1, true).shared == true;

(function(exports) {

  var advectBlock = function(inp, out, u, v, startX, endX, startY, endY, scale) {
    for (var j = startY; j < endY; j++) {
      for (var i = startX; i < endX; i++) {
        var value = inp.sample(i-u.get(i, j)*scale, j-v.get(i, j)*scale);
        out.set(i, j, value);
      }
    }
  };

  var advect = function(inp, out, u, v, scale) {
    var w = inp.width;
    var h = inp.height;
    var block = 32;
    for (var j = 0; j < h; j = j + block) {
      for (var i = 0; i < w; i = i + block) {
        advectBlock(inp, out, u, v, i, i+block, j, j+block, scale);
      }
    }
  };

  var calcDiv = function(u, v, div, scale) {
    var w = u.width;
    var h = u.height
    for (var j = 0; j < w; j++) {
      for (var i = 0; i < h; i++) {
        var value = scale * (
            u.get(i + 1, j) -
            u.get(i - 1, j) +
            v.get(i, j + 1) -
            v.get(i, j - 1)
        );
        div.set(i, j, value);
      }
    }
  };

  var subtractPressure = function(p, u, v, scale) {
    var w = p.width;
    var h = p.height;
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var udiff = scale * (p.get(i + 1, j) - p.get(i - 1, j));
        u.sub(i, j, udiff);

        var vdiff = scale * (p.get(i, j + 1) - p.get(i, j - 1));
        v.sub(i, j, vdiff);
      }
    }
  };

  var zero = function(buf) {
    var w = buf.width;
    var h = buf.height;
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        buf.set(i, j, 0);
      }
    }
  };

  var jacobiIteration = function(inp, fb, out, a, invB, x, y, w, h) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var value = (a * inp.get(x + i, y + j) +
                 fb.get(i-1, j) +
                 fb.get(i+1, j) +
                 fb.get(i, j-1) +
                 fb.get(i, j+1)
        ) * invB;
        out.set(i, j, value);
      }
    }
  };

  var firstJacobiIteration = function(inp, out, a, invB, x, y, w, h) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var value = a * invB * inp.get(x + i, y + j);
        out.set(i, j, value);
      }
    }
  };

  var redBlackIteration = function(inp, out, a, invB, x, y, w, h) {
    // TODO adaptive scale
    var scale = 1.0;

    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        if ((i + j) & 1 != 0) continue;
        var value = (a * inp.get(x + i, y + j) +
                 out.get(i-1, j) +
                 out.get(i+1, j) +
                 out.get(i, j-1) +
                 out.get(i, j+1)
        ) * invB;
        //out.set(i, j, value);
        var current = out.get(i, j, value);
        out.set(i, j, value * scale + current * (1 - scale));
      }
    }

    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        if ((i + j) & 1 != 1) continue;
        var value = (a * inp.get(x + i, y + j) +
                 out.get(i-1, j) +
                 out.get(i+1, j) +
                 out.get(i, j-1) +
                 out.get(i, j+1)
        ) * invB;
        //out.set(i, j, value);
        var current = out.get(i, j, value);
        out.set(i, j, value * scale + current * (1 - scale));
      }
    }
  };

  var jacobiRegion = function(inp, fb, out, params, x, y, w, h) {
    var a = params.a;
    var invB = params.invB;

    if (true) {
      var temp = fb;
      fb = out;
      out = temp;
      firstJacobiIteration(inp, out, a, invB, x, y, w, h);

      for (var k = 1; k < params.iterations; k++) {
        var temp = fb;
        fb = out;
        out = temp;
        jacobiIteration(inp, fb, out, a, invB, x, y, w, h);
      }
    } else {
      for (var k = 0; k < params.iterations / 2; k++) {
        redBlackIteration(inp, out, a, invB, x, y, w, h);
      }
    }
  };

  // Assumes an even number of iterations so that buffer swapping leaves the
  // output in the right place.
  // It is assumed that out is initialized to a reasonable prediction.
  var jacobi = function(inp, fb, out, params) {
    var w = inp.width;
    var h = inp.height;
    jacobiRegion(inp, fb, out, params, 0, 0, w, h);
  };

  var Buffer = function(w, h, data) {
    if (data == undefined) {
      data = new Float32Array(new ArrayBuffer(w * h * 4));
    }
    this.data = data;

    this.setSize(w, h);
  };

  Buffer.prototype.setSize = function(w, h) {
    this.width = w;
    this.height = h;

    this.wshift = (Math.log(w)/Math.LN2)|0;
    this.wmask = (w-1)|0;
    this.hmask = (h-1)|0;
  };

  Buffer.prototype.index = function(x, y) {
    //var w = this.width;
    //var h = this.height;
    //x = x - Math.floor(x / w) * w;
    //y = y - Math.floor(y / h) * h;
    //return y * w + x;
    return ((y & this.hmask) << this.wshift) | (x & this.wmask);
  };

  Buffer.prototype.get = function(x, y) {
    return this.data[this.index(x, y)];
  };

  Buffer.prototype.set = function(x, y, data) {
    this.data[this.index(x, y)] = data;
  };

  Buffer.prototype.sub = function(x, y, data) {
    this.data[this.index(x, y)] -= data;
  };

  var blend = function(x, y, amt) {
    return x * (1 - amt) + y * amt;
  };

  Buffer.prototype.sample = function(x, y) {
    var lx = Math.floor(x);
    var bx = x - lx;
    var ly = Math.floor(y);
    var by = y - ly;

    var s00 = this.get(lx, ly);
    var s10 = this.get(lx+1, ly);
    var s01 = this.get(lx, ly+1);
    var s11 = this.get(lx+1, ly+1);

    var s0 = blend(s00, s10, bx);
    var s1 = blend(s01, s11, bx);
    return blend(s0, s1, by);
  };

  Buffer.prototype.copy = function(other) {
    this.data.set(other.data);
  };

  Buffer.prototype.copySubrect = function(other, srcX, srcY, w, h, dstX, dstY) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        this.set(dstX + i, dstY + j, other.get(srcX + i, srcY + j));
      }
    }
  };

  var TorusShardingPolicy = function(w, h, horizon, shards) {
    this.setShards(w, h, horizon, shards);
    // TODO reduce shards if overcompute is too high.
  };


  TorusShardingPolicy.prototype.squareGrid = function(w, h, horizon, shards) {
    this.gridW = 1;
    this.gridH = 1;
    this.shardW = this.width;
    this.shardH = this.height;

    var temp = this.shards;
    while (temp > 1) {
      if (this.shardW > this.shardH) {
        this.shardW /= 2;
        this.gridW *= 2;
      } else {
        this.shardH /= 2;
        this.gridH *= 2;
      }
      temp /= 2;
    }
  };

  TorusShardingPolicy.prototype.rowGrid = function(w, h, horizon, shards) {
    this.gridW = 1;
    this.gridH = 1;
    this.shardW = this.width;
    this.shardH = this.height;

    var temp = this.shards;
    while (temp > 1) {
      this.shardH /= 2;
      this.gridH *= 2;
      temp /= 2;
    }
  };


  TorusShardingPolicy.prototype.setShards = function(w, h, horizon, shards) {
    this.width = w;
    this.height = h;
    this.shards = shards;

    this.squareGrid();

    if (this.gridW > 1) {
      this.padW = horizon;
    } else {
      this.padW = 0;
    }

    if (this.gridH > 1) {
      this.padH = horizon;
    } else {
      this.padH = 0;
    }

    this.bufferW = this.shardW + this.padW * 2;
    this.bufferH = this.shardH + this.padH * 2;

    this.computeRatio = (this.bufferW * this.bufferH) / (this.shardW * this.shardH);
  };

  TorusShardingPolicy.prototype.shardX = function(i) {
    return (i % this.gridW) * this.shardW;
  };

  TorusShardingPolicy.prototype.shardY = function(i) {
    return Math.floor(i / this.gridW) * this.shardH;
  };

  TorusShardingPolicy.prototype.bufferX = function(i) {
    return this.shardX(i) - this.padW;
  };

  TorusShardingPolicy.prototype.bufferY = function(i) {
    return this.shardY(i) - this.padH;
  };

  TorusShardingPolicy.prototype.gatherShardOutput = function(i, buffer, out) {
    out.copySubrect(buffer, this.padW, this.padH, this.shardW, this.shardH, this.shardX(i), this.shardY(i));
  };

  exports.fluid = {};
  exports.fluid.advect = advect;
  exports.fluid.calcDiv = calcDiv;
  exports.fluid.subtractPressure = subtractPressure;
  exports.fluid.zero = zero;
  exports.fluid.jacobiIteration = jacobiIteration;
  exports.fluid.jacobiRegion = jacobiRegion;
  exports.fluid.jacobi = jacobi;
  exports.fluid.TorusShardingPolicy = TorusShardingPolicy;

  exports.fluid.Buffer = Buffer;

})(this.window || this.self);

if (this.self !== undefined) {
  var state = {};

  var handlers = {
    "init": function(msg) {
      var args = msg.args;
      var w = args.width;
      var h = args.height;
      state.width = w;
      state.height = h;
      state.u = new fluid.Buffer(w, h);
      state.v = new fluid.Buffer(w, h);
      state.inp = new fluid.Buffer(w, h);
      state.fb  = new fluid.Buffer(w, h);
      state.out = new fluid.Buffer(w, h);

      // TODO size?
      state.temp = new fluid.Buffer(w, h);
    },
    "updateVelocity": function(msg) {
      var args = msg.args;
      state.u.data = args.u;
      state.v.data = args.v;
    },
    "jacobi": function(msg) {
      var args = msg.args;
      state.inp.data = args.inp;
      state.out.data = args.out;
      fluid.jacobi(state.inp, state.fb, state.out, args.params);
      self.postMessage({uid: msg.uid, inp: args.inp, out: args.out}, [args.inp.buffer, args.out.buffer]);
    },
    "shardedJacobi": function(msg) {
      var args = msg.args;
      state.inp.data = args.inp;

      state.temp.data = args.out;
      state.temp.setSize(args.outW, args.outH);

      //state.temp.copySubrect(state.inp, args.x|0, args.y|0, args.w|0, args.h|0, 0, 0);
      fluid.jacobiRegion(state.inp, state.fb, state.temp, args.params, args.x, args.y, args.w, args.h);
      self.postMessage({
        uid: msg.uid,
        out: args.out,
      }, [
        args.out.buffer
      ]);
    },
  };

  self.addEventListener('message', function(e) {
    var msg = e.data;

    if (msg.name in handlers) {
      var result = handlers[msg.name](msg);
    } else {
      console.error("Message: " + msg.name);
    }
  }, false);
}
