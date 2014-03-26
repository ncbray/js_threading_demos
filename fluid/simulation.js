"use strict";

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

var PerformanceTracker = function(name, period) {
  this.name = name;
  this.period = period;
  this.accum = 0;
  this.accum2 = 0;
  this.count = 0;
};

PerformanceTracker.prototype.begin = function() {
  this.beginTime = performance.now();
}

PerformanceTracker.prototype.end = function() {
  var dt = performance.now() - this.beginTime;
  this.accum += dt;
  this.accum2 += dt*dt;
  this.count += 1;
  if (this.count >= this.period) {
    var v = (this.accum2 - this.accum*this.accum/this.count)/(this.count - 1);
    console.log(this.name + ": " + (this.accum / this.count) + " / " + Math.sqrt(v));
    this.accum = 0;
    this.accum2 = 0;
    this.count = 0;
  }
};

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
    for (var j = y; j < y+h; j++) {
      for (var i = x; i < x+w; i++) {
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

  var firstJacobiIteration = function(inp, out, a, invB, x, y, w, h) {
    for (var j = y; j < y+h; j++) {
      for (var i = x; i < x+w; i++) {
        var value = a * invB * inp.get(i, j);
        out.set(i, j, value);
      }
    }
  };

  var firstRedBlackIteration = function(inp, out, a, invB, x, y, w, h, color) {
    for (var j = y; j < y+h; j++) {
      for (var i = x; i < x+w; i++) {
        if ((i + j) & 1 != color) continue;
        var value = a * invB * inp.get(i, j);
        out.set(i, j, value);
      }
    }
  };

  var redBlackIteration = function(inp, out, a, invB, x, y, w, h, color) {
    // TODO adaptive scale
    var scale = 1.0;

    for (var j = y; j < y+h; j++) {
      for (var i = x; i < x+w; i++) {
        if ((i + j) & 1 != color) continue;
        var value = (a * inp.get(i, j) +
                 out.get(i-1, j) +
                 out.get(i+1, j) +
                 out.get(i, j-1) +
                 out.get(i, j+1)
        ) * invB;
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
      var color = 0;
      firstRedBlackIteration(inp, out, a, invB, x, y, w, h, color);
      color = 1 - color;
      for (var k = 0; k < params.iterations; k++) {
        redBlackIteration(inp, out, a, invB, x, y, w, h, color);
        color = 1 - color;
      }
    }
  };

  var jacobiPerf = new PerformanceTracker("jacobi", 100);

  var jacobiRegionSync = function(inp, fb, out, params, x, y, w, h, control, controlUint) {
    jacobiPerf.begin();
    var a = params.a;
    var invB = params.invB;

    var temp = fb;
    fb = out;
    out = temp;
    firstJacobiIteration(inp, out, a, invB, x, y, w, h);

    for (var k = 1; k < params.iterations; k++) {
      var temp = fb;
      fb = out;
      out = temp;

      fluid.syncWorkers(control, controlUint);

      jacobiIteration(inp, fb, out, a, invB, x, y, w, h);
    }

    jacobiPerf.end();
  };

  // Assumes an even number of iterations so that buffer swapping leaves the
  // output in the right place.
  // It is assumed that out is initialized to a reasonable prediction.
  var jacobi = function(inp, fb, out, params) {
    var w = inp.width;
    var h = inp.height;
    jacobiRegion(inp, fb, out, params, 0, 0, w, h);
  };

  var ceilPOT = function(value) {
    return Math.pow(2, Math.ceil(Math.log(value)/Math.LN2));
  };

  var Buffer = function(w, h, data) {
    w = ceilPOT(w);
    h = ceilPOT(h);
    if (data === undefined) {
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

  Buffer.prototype.bufferIndex = function(x, y) {
    //var w = this.width;
    //var h = this.height;
    //x = x - Math.floor(x / w) * w;
    //y = y - Math.floor(y / h) * h;
    //return y * w + x;
    return ((y & this.hmask) << this.wshift) | (x & this.wmask);
  };

  Buffer.prototype.get = function(x, y) {
    return this.data[this.bufferIndex(x, y)];
  };

  Buffer.prototype.set = function(x, y, data) {
    this.data[this.bufferIndex(x, y)] = data;
  };

  Buffer.prototype.sub = function(x, y, data) {
    this.data[this.bufferIndex(x, y)] -= data;
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
    var x = this.shardX(i);
    var y = this.shardY(i);
    out.copySubrect(buffer, x, y, this.shardW, this.shardH, x, y);
  };

  TorusShardingPolicy.prototype.fullRect = function() {
    return {x: 0, y: 0, w: this.width, h: this.height};
  };

  TorusShardingPolicy.prototype.shardRect = function(i) {
    return {x: this.shardX(i), y: this.shardY(i), w: this.shardW, h: this.shardH};
  };

  TorusShardingPolicy.prototype.bufferRect = function(i) {
    return {x: this.bufferX(i), y: this.bufferY(i), w: this.bufferW, h: this.bufferH};
  };

  var fluid = {};
  exports.fluid = fluid;
  exports.fluid.advect = advect;
  exports.fluid.calcDiv = calcDiv;
  exports.fluid.subtractPressure = subtractPressure;
  exports.fluid.zero = zero;
  exports.fluid.jacobiIteration = jacobiIteration;
  exports.fluid.jacobiRegion = jacobiRegion;
  exports.fluid.jacobiRegionSync = jacobiRegionSync;
  exports.fluid.jacobi = jacobi;
  exports.fluid.TorusShardingPolicy = TorusShardingPolicy;

  exports.fluid.Buffer = Buffer;

  exports.fluid.ceilPOT = ceilPOT;

  // Horrible hack to work around V8's postMessage changing the effective type
  // of TypedArrays when they are touched by postMessage.
  exports.fluid.marshalFloat32Array = function(obj) {
    if (!(obj instanceof Float32Array)) {
      throw obj;
    }
    return obj.buffer;
  };

  exports.fluid.marshaledBuffer = function(obj) {
    return obj;
  }

  exports.fluid.unmarshalFloat32Array = function(obj) {
    if (!(obj instanceof ArrayBuffer)) {
      throw obj;
    }
    return new Float32Array(obj);
  };

  exports.fluid.controlStatusString = function(controlMem) {
      return controlMem[fluid.control.waiting] + "/" + controlMem[fluid.control.waking] + "/" + controlMem[fluid.control.running];
  };

  exports.fluid.fenceRaw = function(control, controlMem) {
    if (controlMem[fluid.control.running] > 0 || controlMem[fluid.control.waking] > 0) {
      //console.log("Fence: waiting for notification.");
      control.condWait(fluid.control.mainWait, fluid.control.lock);
    } else if (controlMem[fluid.control.waiting] <= 0) {
      console.log("Fence: anomoly detected - no workers: " + fluid.controlStatusString(controlMem));
    } else {
      //console.log("Fence: is NOP.")
    }
  };

  exports.fluid.fence = function(control, controlMem) {
    console.log("Locking.");
    control.mutexLock(fluid.control.lock);
    fluid.fenceRaw(control, controlMem);
    console.log("Unlocking.");
    control.mutexUnlock(fluid.control.lock);
    console.log("Done.");
  };

  exports.fluid.sendCommand = function(cmd, control, controlMem) {
    //console.log("Trying to send " + cmd);
    control.mutexLock(fluid.control.lock);
    //console.log("Got lock. " + fluid.controlStatusString(controlMem));

    // Should be a NOP except (possibly) for the first call to sendCommand.
    fluid.fenceRaw(control, controlMem);

    controlMem[fluid.control.command] = cmd;

    // Wake up the workers.
    var waiting = controlMem[fluid.control.waiting];
    controlMem[fluid.control.waiting] = 0;
    controlMem[fluid.control.waking] = waiting;

    //console.log("Broadcasting. " + fluid.controlStatusString(controlMem));
    control.condBroadcast(fluid.control.workerWait);

    // Wait for the workers to finish.
    fluid.fenceRaw(control, controlMem);

    //console.log("Unlocking.");
    control.mutexUnlock(fluid.control.lock);
    //console.log("Done.");
  };

  exports.fluid.sendJacobiCommand = function(args, control, controlMem, controlFloat) {
    control.mutexLock(fluid.control.lock);
    controlFloat[fluid.control.jacobiA >> 2] = args.a;
    controlFloat[fluid.control.jacobiInvB >> 2] = args.invB;
    controlMem[fluid.control.jacobiIterations] = args.iterations;
    control.mutexUnlock(fluid.control.lock);
    fluid.sendCommand(fluid.control.JACOBI, control, controlMem);
  };

  exports.fluid.sendQuitCommand = function(control, controlMem) {
    fluid.sendCommand(fluid.control.QUIT, control, controlMem);
  };

  var syncPerf = new PerformanceTracker("sync", 5000);

  exports.fluid.syncWorkers = function(control, controlUint) {
    syncPerf.begin();
    if (true) {
      control.barrierWait(fluid.control.workerBarrier);
    } else {
      control.mutexLock(fluid.control.barrierMutex);
      controlUint[fluid.control.barrierCurrent>>2] += 1;
      if (controlUint[fluid.control.barrierCurrent>>2] >= controlUint[fluid.control.barrierMax>>2] ) {
        control.condWait(fluid.control.barrierSemiphore, fluid.control.barrierMutex);
      } else {
        controlUint[fluid.control.barrierCurrent>>2] = 0;
        control.condBroadcast(fluid.control.barrierSemiphore);
      }
      control.mutexUnlock(fluid.control.barrierMutex);
    }
    syncPerf.end();
  };


  exports.fluid.control = {
    lock: 0,
    workerWait: 64,
    mainWait: 128,

    waiting: 256,
    waking: 257,
    running: 258,
    command: 259,
    args: 260,

    jacobiA: 260,
    jacobiInvB: 264,
    jacobiIterations: 268,

    workerBarrier: 512,

    barrierMutex: 768,
    barrierSemiphore: 832,
    barrierMax: 896,
    barrierCurrent: 900,

    size: 1024,

    INIT: 0,
    JACOBI: 1,
    QUIT: 2
  };

})(this.window || this.self);

if (this.self !== undefined) {
  var state = {};

  var handlers = {
    "init": function(msg) {
      var args = msg.args;
      var w = args.w;
      var h = args.h;

      state.w = args.w;
      state.h = args.h;

      state.workerID = args.workerID;
      state.shards = args.shards;

      state.u = new fluid.Buffer(w, h);
      state.v = new fluid.Buffer(w, h);
      state.inp = new fluid.Buffer(w, h);
      state.fb  = new fluid.Buffer(w, h);
      state.out = new fluid.Buffer(w, h);

      // HACK assuming readonly based on presense of args.broadcast.
      if (args.broadcast) {
        state.broadcast = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.broadcast));
        state.reply = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.reply));
      }
      // Overallocate to allow for varying iteration counts.
      state.temp = new fluid.Buffer(w, h);
    },
    "updateVelocity": function(msg) {
      var args = msg.args;
      state.u.data = fluid.unmarshalFloat32Array(args.u);
      state.v.data = fluid.unmarshalFloat32Array(args.v);
    },
    "jacobi": function(msg) {
      var args = msg.args;
      state.inp.data = fluid.unmarshalFloat32Array(args.inp);
      state.out.data = fluid.unmarshalFloat32Array(args.out);
      fluid.jacobi(state.inp, state.fb, state.out, args.params);
      self.postMessage(
        {uid: msg.uid, inp: args.inp, out: args.out},
        [fluid.marshaledBuffer(args.inp), fluid.marshaledBuffer(args.out)]
      );
    },
    "shardedJacobi": function(msg) {
      var begin = performance.now();
      var args = msg.args;
      state.inp.data = fluid.unmarshalFloat32Array(args.inp);
      state.temp.data = fluid.unmarshalFloat32Array(args.out);

      var policy = new fluid.TorusShardingPolicy(state.w, state.h, args.params.iterations - 1, state.shards);
      fluid.jacobiRegion(state.inp, state.fb, state.temp, args.params,
                         policy.bufferX(state.workerID), policy.bufferY(state.workerID),
                         policy.bufferW, policy.bufferH);
      self.postMessage({
        uid: msg.uid,
        out: args.out,
        time: performance.now() - begin
      }, [
        fluid.marshaledBuffer(args.out)
      ]);
    },
    "shardedJacobiRO": function(msg) {
      var begin = performance.now();
      var args = msg.args;

      var policy = new fluid.TorusShardingPolicy(state.w, state.h, args.params.iterations - 1, state.shards);
      fluid.jacobiRegion(state.broadcast, state.fb, state.temp, args.params,
                         policy.bufferX(state.workerID), policy.bufferY(state.workerID),
                         policy.bufferW, policy.bufferH);

      policy.gatherShardOutput(state.workerID, state.temp, state.reply);

      self.postMessage({
        uid: msg.uid,
        time: performance.now() - begin
      });
    },

    "initMain": function(msg) {
      var args = msg.args;
      state.control = args.control;
      state.controlMem = new Uint8Array(args.control);
      state.controlFloat = new Float32Array(args.control);
    },

    "jacobiMain": function(msg) {
      var begin = performance.now();
      fluid.sendJacobiCommand(msg.args, state.control, state.controlMem, state.controlFloat)
      self.postMessage({uid: msg.uid, time: performance.now() - begin});
    },

    "quitMain": function(msg) {
      var begin = performance.now();
      fluid.sendQuitCommand(state.control, state.controlMem)
      console.log("quit " + (performance.now() - begin));
      self.postMessage({uid: msg.uid});
    },

    "initSAB": function(msg) {
      var args = msg.args;
      var w = args.w;
      var h = args.h;

      state.w = args.w;
      state.h = args.h;
      state.workerID = args.workerID;
      state.shards = args.shards;

      state.broadcast = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.broadcast));
      state.fb = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.fb));
      state.reply = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.reply));
      state.u = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.u));
      state.v = new fluid.Buffer(w, h, fluid.unmarshalFloat32Array(args.v));

      state.temp = new fluid.Buffer(w, h);

      // TODO do red black and eliminate feedback buffer.
      state.localFB  = new fluid.Buffer(w, h);

      var control = args.control;
      var controlMem = new Uint8Array(control);
      var controlUint = new Uint32Array(control);
      var controlFloat = new Float32Array(control);

      var statusString = function() {
        return state.workerID + ": " + fluid.controlStatusString(controlMem);
      };

      while (true) {
        //console.log("loop " + state.workerID);
        control.mutexLock(fluid.control.lock);
        //console.log("locked " + statusString());
        controlMem[fluid.control.running] -= 1;
        controlMem[fluid.control.waiting] += 1;
        if (controlMem[fluid.control.running] <= 0 && controlMem[fluid.control.waking] <= 0) {
          // Notify we've fenced.
          //console.log("Signaling fence.");
          control.condSignal(fluid.control.mainWait);
        }

        //console.log("waiting " + statusString());
        control.condWait(fluid.control.workerWait, fluid.control.lock);
        //console.log("woken " + statusString());
        controlMem[fluid.control.waking] -= 1;
        controlMem[fluid.control.running] += 1;
        var cmd = controlMem[fluid.control.command];
        control.mutexUnlock(fluid.control.lock);

        //console.log("command " + cmd);

        if (cmd == fluid.control.JACOBI) {
          var jparams = {
            a: controlFloat[fluid.control.jacobiA >> 2],
            invB: controlFloat[fluid.control.jacobiInvB >> 2],
            iterations: controlMem[fluid.control.jacobiIterations]
          };

          if (false) {
            var policy = new fluid.TorusShardingPolicy(state.w, state.h, jparams.iterations - 1, state.shards);
            fluid.jacobiRegion(state.broadcast, state.localFB, state.temp, jparams,
                               policy.bufferX(state.workerID), policy.bufferY(state.workerID),
                               policy.bufferW, policy.bufferH);
            policy.gatherShardOutput(state.workerID, state.temp, state.reply);
          } else {
            var policy = new fluid.TorusShardingPolicy(state.w, state.h, 0, state.shards);
            fluid.jacobiRegionSync(state.broadcast, state.fb, state.reply, jparams,
                                   policy.bufferX(state.workerID), policy.bufferY(state.workerID),
                                   policy.bufferW, policy.bufferH,
                                   control, controlUint);

            //policy.gatherShardOutput(state.workerID, state.temp, state.reply);
          }

        } else {
          break;
        }
      }

      control.mutexLock(fluid.control.lock);
      console.log("Saying goodbye. " + statusString());
      controlMem[fluid.control.running] -= 1;
      if (controlMem[fluid.control.running] <= 0 && controlMem[fluid.control.waking] <= 0) {
        // Notify we've fenced.
        console.log("Signaling fence.");
        control.condSignal(fluid.control.mainWait);
      }
      control.mutexUnlock(fluid.control.lock);
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
