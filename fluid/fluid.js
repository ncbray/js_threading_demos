"use strict";
(function(exports) {

  var genNoise = function(state) {
    var r = state.r;
    var g = state.g;
    var b = state.b;

    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        r.set(i, j, 0.5);
        g.set(i, j, 0.5);
        b.set(i, j, 0.5);
      }
    }
  };

  // Fluid simulation based on:
  // http://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf

  var diffuse = function(proxy, inp, out, dx, diff, drag, dt) {
    // The input is a good inital approximation of the output.
    out.copy(inp);

    var denomA = dt * diff;
    if (denomA == 0) {
      return;
    }
    var a = dx * dx / denomA;
    var drag = Math.pow(1-drag, dt);

    var jparams = {
      iterations: 30,
      a: a,
      invB: drag / (4 + a),
    };

    return Promise.resolve(undefined).then(function() {
      jacobiTime.beginSlice();
      return proxy.jacobi(inp, out, jparams);
    }).then(function() {
      jacobiTime.endSlice();
    });
  };

  var project = function(proxy, state) {
    var scale = 0.5;
    return Promise.resolve(undefined).then(function() {
      return proxy.calcDiv(state.div, scale);
    }).then(function() {
      return proxy.zero(state.p);
    }).then(function() {
      var jparams = {
        iterations: 30,
        a: -1,
        invB: 1/4,
      };
      return Promise.resolve(undefined).then(function() {
        jacobiTime.beginSlice();
        return proxy.jacobi(state.div, state.p, jparams);
      });
    }).then(function() {
        jacobiTime.endSlice();
      return proxy.subtractPressure(state.p, state.u, state.v, scale);
    }).then(function() {
      copyTime.beginSlice();
      return proxy.updateVelocity(state.u, state.v);
    }).then(function() {
      copyTime.endSlice();
    });
  };

  var advectColor = function(proxy, state, dt) {
    // Advect the density.
    var din = state.r;
    var dout = state.temp0;

    return Promise.resolve(undefined).then(function() {
      advectTime.beginSlice();
      return proxy.advect(din, dout, dt);
    }).then(function() {
      state.r = dout;
      state.temp0 = din;
      din = state.g;
      dout = state.temp0;
    }).then(function() {
      return proxy.advect(din, dout, dt);
    }).then(function() {
      state.g = dout;
      state.temp0 = din;
      din = state.b;
      dout = state.temp0;
    }).then(function() {
      return proxy.advect(din, dout, dt);
    }).then(function() {
      advectTime.endSlice();
      state.b = dout;
      state.temp0 = din;
    });
  };

  var updateVelocity = function(proxy, state) {
    // Swap the buffers.
    var temp = state.u;
    state.u = state.temp0;
    state.temp0 = temp;

    temp = state.v;
    state.v = state.temp1;
    state.temp1 = temp;

    // Broadcast.
    return proxy.updateVelocity(state.u, state.v);
  };

  var tickUID = 0;

  var simulateFluid = function(state, dt) {
    if (dt == 0) {
      return;
    }
    dt *= 10;

    var proxy = state.proxy;
    var tick = tickUID;
    tickUID += 1;

    return Promise.resolve(undefined).then(function() {
      return advectColor(proxy, state, dt);
    }).then(function() {
      if (config.diffuse != 0) {
        // Diffuse the velocity.
        return Promise.resolve(undefined).then(function() {
          return diffuse(proxy, state.u, state.temp0, state.dx, config.diffuse, config.drag, dt);
        }).then(function() {
          return diffuse(proxy, state.v, state.temp1, state.dx, config.diffuse, config.drag, dt);
        }).then(function() {
          copyTime.beginSlice();
          return updateVelocity(proxy, state);
        }).then(function() {
          copyTime.endSlice();
          // Correct the diffused velocity.
          return project(proxy, state);
        });
      }
    }).then(function() {
      // Advect the velocity.
      return Promise.resolve(undefined).then(function() {
        advectTime.beginSlice();
        return proxy.advect(state.u, state.temp0, dt);
      }).then(function() {
        return proxy.advect(state.v, state.temp1, dt);
      }).then(function() {
        advectTime.endSlice();
        copyTime.beginSlice();
        return updateVelocity(proxy, state);
      })
    }).then(function() {
      copyTime.endSlice();
      // Correct the avected velocity.
      return project(proxy, state);
    });
  };

  var drawData = function(state, inp, scale, offset) {
    var out = state.pixelInts;
    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = j * state.width + i;
        var value = demolition.linearToByte(inp.get(i, j)*scale+offset);
        out[base] = demolition.byteColorToInt(value, value, value);
      }
    }
    state.buffer.data.set(state.pixelBytes);
    return state.buffer;
  };

  var drawRGBData = function(state, r, g, b, scale, offset) {
    var out = state.pixelInts;
    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = j * state.width + i;
        var rv = demolition.linearToByte(r.get(i, j)*scale+offset);
        var gv = demolition.linearToByte(g.get(i, j)*scale+offset);
        var bv = demolition.linearToByte(b.get(i, j)*scale+offset);
        out[base] = demolition.byteColorToInt(rv, gv, bv);
      }
    }
    state.buffer.data.set(state.pixelBytes);
    return state.buffer;
  };

  var drawCircle = function(data, x, y, r0, r1, c, amt) {
    for (var j = -r1; j <= r1; j++) {
      for (var i = -r1; i <= r1; i++) {
        var d = Math.sqrt(i*i + j*j);
        if (d > r1) {
          continue
        }
        var existing = data.get(x + i, y + j);
        var a = 1 - demolition.smoothstep(r0, r1, d);
        data.set(x + i, y + j, demolition.blend(existing, c, a * amt));
      }
    }
  };

  var splat = function(state) {
    var x = (Math.random() * state.width)|0;
    var y = (Math.random() * state.height)|0;

    var scale = (state.width + 10) / (256 + 10);

    var r0 = ((10 + Math.random() * 30)*scale)|0;
    var r1 = r0 + 1;
    var c = Math.random();
    drawCircle(state.r, x, y, r0, r1, c, 0.9);
    c = Math.random();
    drawCircle(state.g, x, y, r0, r1, c, 0.9);
    c = Math.random();
    drawCircle(state.b, x, y, r0, r1, c, 0.9);
  };

  var draw = function() {
    drawTime.begin();
    var ctx = state.ctx;

    var d = drawRGBData(state, state.r, state.g, state.b, 1, 0);
    for (var j = 0; j < state.tile; j++) {
      for (var i = 0; i < state.tile; i++) {
        ctx.putImageData(d, (i * state.width)|0, (j * state.height)|0);
      }
    }

    if (config.show_debug) {
      if (true) {
        var d = drawRGBData(state, state.u, state.v, state.p, 0.2, 0.5);
        ctx.putImageData(d, state.width * (state.tile - 1), state.height * (state.tile - 1));
      } else {
        var u = drawData(state, state.u, 0.2, 0.5);
        ctx.putImageData(u, state.width * (state.tile - 1), state.height * (state.tile - 2));

        var v = drawData(state, state.v, 0.2, 0.5);
        ctx.putImageData(v, state.width * (state.tile - 2), state.height * (state.tile - 1));

        var p = drawData(state, state.p, 0.2, 0.5);
        ctx.putImageData(p, state.width * (state.tile - 1), state.height * (state.tile - 1));
      }
    }
    drawTime.end();
  };

  var autoSplat = function(dt) {
    state.phase = state.phase + dt;
    while (state.phase >= 1.0) {
      splat(state);
      state.phase -= 1.0;
    }
  };

  var frame = function(dt) {
    frameTime.begin();
    state.pending = Promise.resolve(undefined).then(function() {
      autoSplat(dt);
    }).then(function() {
      simTime.begin();
    }).then(function() {
      return simulateFluid(state, dt);
    }).then(function() {
      simTime.end();
      jacobiTime.commit();
      advectTime.commit();
      copyTime.commit();
      frameTime.end();
    }).then(draw).then(function () {
      if (!config.single_step) {
        runner.scheduleFrame();
      }
    });
  };

  var mouseMove = function(x, y) {
    var t = performance.now() / 1000;
    var dt = Math.max(t - state.mouseTime, 0.01);
    var scale = 1 / dt;

    var dx = x - state.mouseX;
    var dy = y - state.mouseY;

    var vx = dx * scale;
    var vy = dy * scale;


    var hype = state.dx;
    var steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2 + 1;

    var amt = 0.2;

    for (var i = 0; i < steps; i += 2) {
      var sx = demolition.blend(x, state.mouseX, i/steps);
      var sy = demolition.blend(y, state.mouseY, i/steps);
      drawCircle(state.u, sx, sy, 1, 7, vx * hype, amt);
      drawCircle(state.v, sx, sy, 1, 7, vy * hype, amt);
    }

    state.mouseX = x;
    state.mouseY = y;
    state.mouseTime = t;
  };

  var createBuffer = function(w, h) {
    return new fluid.Buffer(w, h);
  };


  var localProxy = function(w, h) {
    this.fb = createBuffer(w, h);
    this.alive = true;
  };

  localProxy.prototype.updateVelocity = function(u, v) {
    if (!this.alive) throw "dead proxy";
    this.u = u;
    this.v = v;
  };

  localProxy.prototype.advect = function(inp, out, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.advect(inp, out, this.u, this.v, scale);
  };

  localProxy.prototype.calcDiv = function(div, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.calcDiv(this.u, this.v, div, scale);
  };

  localProxy.prototype.subtractPressure = function(p, u, v, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.subtractPressure(p, u, v, scale);
  };

  localProxy.prototype.jacobi = function(inp, out, jparams) {
    if (!this.alive) throw "dead proxy";
    fluid.jacobi(inp, this.fb, out, jparams);
  };

  localProxy.prototype.zero = function(data) {
    if (!this.alive) throw "dead proxy";
    fluid.zero(data);
  };

  localProxy.prototype.shutdown = function() {
    if (!this.alive) throw "dead proxy";
    this.alive = false;
  };


  var RPCWorker = function(worker) {
    this.worker = worker;
    this.uid = 1;
    this.callbacks = {};
    this.alive = true;

    var this_ = this;
    worker.addEventListener("message", function(e) {
      if (!this_.alive) return;
      var msg = e.data;
      var callback = this_.callbacks[msg.uid];
      if (callback) {
        delete this_.callbacks[msg.uid];
        callback(msg);
      } else {
        console.error(msg);
      }
    }, false);
  };

  RPCWorker.prototype.rpc = function(name, args, callback, transfer) {
    var uid = 0;
    if (callback) {
      uid = this.uid;
      this.uid += 1;
      this.callbacks[uid] = callback;
    }
    this.worker.postMessage({name: name, uid: uid, args: args}, transfer);
  };

  RPCWorker.prototype.terminate = function() {
    this.alive = false;
    this.callbacks = {};
    this.worker.terminate();
  };

  var containingPOT = function(value) {
    return Math.pow(2, Math.ceil(Math.log(value)/Math.LN2));
  };

  var remoteProxy = function(w, h, shards, readonly) {
    // TODO plumb through horizon.
    this.policy = new fluid.TorusShardingPolicy(w, h, 29, shards);

    this.shards = [];
    this.shardOut = [];

    var initArgs = {width: w, height: h};
    var initTransfer = [];

    if (readonly) {
      this.broadcast = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      initArgs.broadcast = this.broadcast.data;
      initTransfer.push(this.broadcast.data.buffer);
    }

    for (var i = 0; i < this.policy.shards; i++) {
      var worker = new Worker('simulation.js');
      var shard = new RPCWorker(worker);
      shard.rpc("init", initArgs, undefined, initTransfer);
      this.shards.push(shard);
      // Note image buffers must be power-of-two sized.
      this.shardOut.push(new fluid.Buffer(
        containingPOT(this.policy.bufferW),
        containingPOT(this.policy.bufferH)
      ));
    }
    this.alive = true;

    this.readonly = readonly;

    if (readonly) {
      this.u = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      this.v = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      for (var i = 0; i < this.shards.length; i++) {
        this.shards[i].rpc(
          "updateVelocity",
          {
            u: this.u.data,
            v: this.v.data
          },
          undefined,
          [this.u.data.buffer, this.v.data.buffer]
        );
      }
    }
  };

  remoteProxy.prototype.updateVelocity = function(u, v) {
    if (!this.alive) throw "dead proxy";

    if (this.readonly) {
      this.u.data.set(u.data);
      this.v.data.set(v.data);
      // TODO simulate event send.
    } else {
      for (var i = 0; i < this.shards.length; i++) {
        this.shards[i].rpc(
          "updateVelocity",
          {
            u: u.data,
            v: v.data
          }
        );
      }
      // HACK
      this.u = u;
      this.v = v;
    }
  };

  remoteProxy.prototype.advect = function(inp, out, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.advect(inp, out, this.u, this.v, scale);
  };

  remoteProxy.prototype.calcDiv = function(div, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.calcDiv(this.u, this.v, div, scale);
  };

  remoteProxy.prototype.subtractPressure = function(p, u, v, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.subtractPressure(p, u, v, scale);
  };

  var printStats = function(name, times) {
    var total = times[0];
    var min = times[0];
    var max = times[0];
    for (var i = 1; i < times.length; i++) {
      total += times[i];
      if (times[i] > max) {
        max = times[i];
      }
      if (times[i] < min) {
        min = times[i];
      }
    }
    console.log(name, min, total / times.length, max);
  };

  remoteProxy.prototype.jacobi = function(inp, out, jparams) {
    if (!this.alive) throw "dead proxy";
    var proxy = this;

    var outsidetime = [];
    var insidetime = [];
    var deltatime = [];

    if (this.shards.length > 1) {
      return new Promise(function(resolve) {
        if (proxy.readonly) {
          proxy.broadcast.copy(inp);
        }
        //proxy.zero(out);
        var remaining = proxy.shards.length;
        for (var i = 0; i < remaining; i++) {
          (function(i) {
            var begin = performance.now();
            var temp = proxy.shardOut[i];
            var transfer = [temp.data.buffer];

            var args = {
              // Can't just send the wrapper object because postmessage strips the type.  Meh.
              out: temp.data,
              outW: temp.width,
              outH: temp.height,
              x: proxy.policy.bufferX(i),
              y: proxy.policy.bufferY(i),
              w: proxy.policy.bufferW,
              h: proxy.policy.bufferH,
              params: jparams
            };
            if (!proxy.readonly) {
              args.inp = inp.data;
            }

            proxy.shards[i].rpc(
              "shardedJacobi",
              args,
              function(result) {
                temp.data = result.out;
                proxy.policy.gatherShardOutput(i, temp, out);
                var time = performance.now() - begin;
                outsidetime.push(time);
                insidetime.push(result.time);
                deltatime.push(time - result.time);
                remaining -= 1;
                if (remaining <= 0) {
                  //printStats("Outside", outsidetime);
                  //printStats("Inside", insidetime);
                  //printStats("Delta", deltatime);
                  resolve();
                }
              },
              transfer
            );
          })(i);
        }
      });
    } else {
      return new Promise(function(resolve) {
        proxy.shards[0].rpc(
          "jacobi",
          {
            inp: inp.data,
            out: out.data,
            params: jparams
          },
          function(result) {
            inp.data = result.inp;
            out.data = result.out;
            resolve();
          },
          [
            inp.data.buffer,
            out.data.buffer
          ]
        )
      });
    }
  };

  remoteProxy.prototype.zero = function(data) {
    if (!this.alive) throw "dead proxy";
    fluid.zero(data);
  };

  remoteProxy.prototype.shutdown = function() {
    if (!this.alive) throw "dead proxy";
    this.alive = false;
    for (var i = 0; i < this.shards.length; i++) {
      this.shards[i].terminate();
    }
  };

  var syncConfig = function() {
    var c = document.getElementsByTagName("canvas")[0];

    state.fullWidth = +c.width;
    state.fullHeight = +c.height;

    state.tile = config.tiles;
    state.width = (state.fullWidth / state.tile)|0;
    state.height = (state.fullHeight / state.tile)|0;

    //state.dx = 1 / Math.min(state.width, state.height);
    state.dx = 1 / Math.min(256, 256);

    state.wshift = (Math.log(state.width)/Math.LN2)|0;
    state.wmask = (state.width-1)|0;
    state.hmask = (state.height-1)|0;

    state.phase = 0;

    // Simulation
    state.r = createBuffer(state.width, state.height);
    state.g = createBuffer(state.width, state.height);
    state.b = createBuffer(state.width, state.height);

    state.u = createBuffer(state.width, state.height);
    state.v = createBuffer(state.width, state.height);
    state.div = createBuffer(state.width, state.height);
    state.p = createBuffer(state.width, state.height);

    state.temp0 = createBuffer(state.width, state.height);
    state.temp1 = createBuffer(state.width, state.height);

    // Buffer for simulation => pixel conversion
    state.pixelData = new ArrayBuffer(state.width * state.height * 4);
    state.pixelBytes = new Uint8ClampedArray(state.pixelData);
    state.pixelInts = new Uint32Array(state.pixelData);

    state.buffer = state.ctx.createImageData(state.width, state.height);

    if (state.proxy) {
      state.proxy.shutdown();
    }
    if (state.pending) {
      state.pending.cancel();
    }

    var readonly = config.proxy == "readonly";
    if (config.proxy == "remote" || readonly) {
      state.proxy = new remoteProxy(state.width, state.height, config.shards, readonly);
    } else {
      state.proxy = new localProxy(state.width, state.height);
    }
    state.proxy.updateVelocity(state.u, state.v);

    genNoise(state);

    for (var i = 0; i < 10; i++) {
      splat(state);
    }

    runner.scheduleFrame();
  };

  exports.runFluid = function() {
    var c = document.getElementsByTagName("canvas")[0];
    state.ctx = c.getContext("2d");

    syncConfig();

    state.mouseX = 0;
    state.mouseY = 0;
    state.mouseTime = -1000000000;

    c.addEventListener('mousemove', function(e) {
      mouseMove(e.offsetX === undefined ? e.layerX : e.offsetX, e.offsetY === undefined ? e.layerY : e.offsetY);
    });

    // Simulation timer.
    var parent = document.createElement("span");
    document.body.appendChild(parent);
    parent.style.width = "200px";
    parent.style.display = "inline-block";

    parent.appendChild(simTime.domElement);
    parent.appendChild(jacobiTime.domElement);
    parent.appendChild(advectTime.domElement);
    parent.appendChild(copyTime.domElement);
    parent.appendChild(drawTime.domElement);
    parent.appendChild(frameTime.domElement);

    var button = document.createElement("input");
    button.type = "button";
    button.value = "Step";
    button.disabled = !config.single_step;
    button.onclick = function() {
      frame(0.05);
    };
    document.body.appendChild(button);

    var gui = new dat.GUI({autoPlace: false});

    gui.add(config, "diffuse", 0, 0.00001);
    gui.add(config, "drag", 0, 0.1);
    gui.add(config, "tiles", [1, 2, 4, 8, 16]).onFinishChange(syncConfig);
    gui.add(config, "show_debug");
    gui.add(config, "single_step").onFinishChange(function() {
      button.disabled = !config.single_step;
      if (!config.single_step) {
        runner.scheduleFrame();
      }
    });

    var proxies = ["local", "remote"];
    if (sharedMemorySupported) {
      proxies.push("readonly");
    }
    gui.add(config, "proxy", proxies).onFinishChange(syncConfig);
    gui.add(config, "shards", [1, 2, 4, 8, 16]).onFinishChange(syncConfig);

    document.body.appendChild(gui.domElement);
  };

  var Config = function() {
    this.diffuse = 0.000002;
    this.drag = 0;
    this.tiles = 2;
    this.show_debug = false;
    this.single_step = false;

    this.shards = 4;
    this.proxy = "local";
  };

  var config = new Config();

  var state = {};

  var simTime = new PerfTracker("Sim", 200, 60);
  var jacobiTime = new PerfTracker("Jacobian", 200, 60);
  var advectTime = new PerfTracker("Advect", 200, 60);
  var copyTime = new PerfTracker("Copy", 200, 60);
  var drawTime = new PerfTracker("Draw", 200, 60);
  var frameTime = new PerfTracker("Frame", 200, 60);

  var runner = new demolition.DemoRunner();
  runner.onFrame(frame).autoPump(false);
})(window);
