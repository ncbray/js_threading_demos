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

  var jacobiIteration = function(inp, fb, out, params) {
    var a = params.a;
    var invB = params.invB;

    var w = inp.width;
    var h = inp.height;

    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var value = (a * inp.get(i, j) +
                 fb.get(i-1, j) +
                 fb.get(i+1, j) +
                 fb.get(i, j-1) +
                 fb.get(i, j+1)
        ) * invB;
        out.set(i, j, value);
      }
    }
  };

  // Assumes an even number of iterations so that buffer swapping leaves the
  // output in the right place.
  // It is assumed that out is initialized to a reasonable prediction.
  var jacobi = function(inp, fb, out, params) {
    for (var k = 0; k < params.iterations; k++) {
      var temp = fb;
      fb = out;
      out = temp;
      jacobiIteration(inp, fb, out, params);
    }
  };

  var Buffer = function(w, h, data) {
    if (data == undefined) {
      data = new Float32Array(new ArrayBuffer(w * h * 4));
    }
    this.data = data;

    this.width = w;
    this.height = h;

    this.wshift = (Math.log(w)/Math.LN2)|0;
    this.wmask = (w-1)|0;
    this.hmask = (h-1)|0;
  };

  Buffer.prototype.get = function(x, y) {
    return this.data[((y & this.hmask) << this.wshift) | (x & this.wmask)];
  };

  Buffer.prototype.set = function(x, y, data) {
    this.data[((y & this.hmask) << this.wshift) | (x & this.wmask)] = data;
  };

  Buffer.prototype.sub = function(x, y, data) {
    this.data[((y & this.hmask) << this.wshift) | (x & this.wmask)] -= data;
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

    var s0 = demolition.blend(s00, s10, bx);
    var s1 = demolition.blend(s01, s11, bx);
    return demolition.blend(s0, s1, by);
  };

  Buffer.prototype.copy = function(other) {
    this.data.set(other.data);
  };

  exports.fluid = {};
  exports.fluid.advect = advect;
  exports.fluid.calcDiv = calcDiv;
  exports.fluid.subtractPressure = subtractPressure;
  exports.fluid.zero = zero;
  exports.fluid.jacobiIteration = jacobiIteration;
  exports.fluid.jacobi = jacobi;

  exports.fluid.Buffer = Buffer;

})(this.window || this.self);
