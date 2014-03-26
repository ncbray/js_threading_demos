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

  var genericProxy = function() {
    this.alive = true;
  };

  genericProxy.prototype.init = function() {
  };

  genericProxy.prototype.updateVelocity = function(u, v) {
    if (!this.alive) throw "dead proxy";
    this.u = u;
    this.v = v;
  };

  genericProxy.prototype.advect = function(inp, out, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.advect(inp, out, this.u, this.v, scale);
  };

  genericProxy.prototype.calcDiv = function(div, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.calcDiv(this.u, this.v, div, scale);
  };

  genericProxy.prototype.subtractPressure = function(p, u, v, scale) {
    if (!this.alive) throw "dead proxy";
    fluid.subtractPressure(p, u, v, scale);
  };

  genericProxy.prototype.jacobi = function(inp, out, jparams) {
    if (!this.alive) throw "dead proxy";
    fluid.jacobi(inp, this.fb, out, jparams);
  };

  genericProxy.prototype.zero = function(data) {
    if (!this.alive) throw "dead proxy";
    fluid.zero(data);
  };

  genericProxy.prototype.shutdown = function() {
    if (!this.alive) throw "dead proxy";
    this.alive = false;
  };

  var localProxy = function(w, h) {
    this.fb = createBuffer(w, h);
  };

  localProxy.prototype = new genericProxy();

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


  var remoteProxy = function(w, h, shards, readonly) {
    this.w = w;
    this.h = h;
    this.shardCount = shards;

    this.shards = [];
    this.shardOut = [];

    var initArgs = {
      w: w,
      h: h,
      shards: shards,
    };
    var initTransfer = [];

    if (readonly) {
      this.broadcast = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      initArgs.broadcast = fluid.marshalFloat32Array(this.broadcast.data);
      initTransfer.push(this.broadcast.data.buffer);

      this.reply = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      initArgs.reply = fluid.marshalFloat32Array(this.reply.data);
      initTransfer.push(this.reply.data.buffer);
    }

    for (var i = 0; i < this.shardCount; i++) {
      var shard = new RPCWorker(new Worker('simulation.js'));
      initArgs.workerID = i;
      shard.rpc("init", initArgs, undefined, initTransfer);
      this.shards.push(shard);
      // Overallocate to deal with varying iteration counts.
      this.shardOut.push(new fluid.Buffer(w, h));
    }

    this.readonly = readonly;

    if (readonly) {
      this.u = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      this.v = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
      for (var i = 0; i < this.shards.length; i++) {
        this.shards[i].rpc(
          "updateVelocity",
          {
            u: fluid.marshalFloat32Array(this.u.data),
            v: fluid.marshalFloat32Array(this.v.data)
          },
          undefined,
          [this.u.data.buffer, this.v.data.buffer]
        );
      }
    }
  };

  remoteProxy.prototype = new genericProxy();

  remoteProxy.prototype.updateVelocity = function(u, v) {
    if (!this.alive) throw "dead proxy";

    if (this.readonly) {
      this.u.data.set(u.data);
      this.v.data.set(v.data);
      // TODO simulate event send.
    } else {
      // Local methods will also need access to the velocity fields.
      this.u = u;
      this.v = v;
      for (var i = 0; i < this.shards.length; i++) {
        this.shards[i].rpc(
          "updateVelocity",
          {
            u: fluid.marshalFloat32Array(u.data),
            v: fluid.marshalFloat32Array(v.data)
          }
        );
      }
    }
  };

  remoteProxy.prototype.jacobi = function(inp, out, jparams) {
    if (!this.alive) throw "dead proxy";
    var proxy = this;

    var outsidetime = [];
    var insidetime = [];
    var deltatime = [];

    var shardDone = function(outside, inside) {
      outsidetime.push(outside);
      insidetime.push(inside);
      deltatime.push(outside - inside);
    };

    var printAllStats = function() {
      printStats("Outside", outsidetime);
      printStats("Inside", insidetime);
      printStats("Delta", deltatime);
    };

    var policy = new fluid.TorusShardingPolicy(proxy.w, proxy.h, jparams.iterations - 1, proxy.shards.length);

    if (this.shards.length > 1) {
      return new Promise(function(resolve) {
        if (proxy.readonly) {
          proxy.broadcast.copy(inp);
        }
        var remaining = proxy.shards.length;
        for (var i = 0; i < remaining; i++) {
          (function(i) {
            //var begin = performance.now();
            if (proxy.readonly) {
              proxy.shards[i].rpc(
                "shardedJacobiRO",
                {
                  params: jparams
                },
                function(result) {
                  //shardDone(performance.now() - begin, result.time);
                  remaining -= 1;
                  if (remaining <= 0) {
                    out.copy(proxy.reply);
                    //printAllStats();
                    resolve();
                  }
                }
              );
            } else {
              var temp = proxy.shardOut[i];
              proxy.shards[i].rpc(
                "shardedJacobi",
                {
                  inp: fluid.marshalFloat32Array(inp.data),
                  out: fluid.marshalFloat32Array(temp.data),
                  params: jparams
                },
                function(result) {
                  temp.data = fluid.unmarshalFloat32Array(result.out);
                  policy.gatherShardOutput(i, temp, out);
                  //shardDone(performance.now() - begin, result.time);
                  remaining -= 1;
                  if (remaining <= 0) {
                    //printAllStats();
                    resolve();
                  }
                },
                [temp.data.buffer]
              );
            }
          })(i);
        }
      });
    } else {
      return new Promise(function(resolve) {
        proxy.shards[0].rpc(
          "jacobi",
          {
            inp: fluid.marshalFloat32Array(inp.data),
            out: fluid.marshalFloat32Array(out.data),
            params: jparams
          },
          function(result) {
            inp.data = fluid.unmarshalFloat32Array(result.inp);
            out.data = fluid.unmarshalFloat32Array(result.out);
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

  remoteProxy.prototype.shutdown = function() {
    if (!this.alive) throw "dead proxy";
    this.alive = false;
    for (var i = 0; i < this.shards.length; i++) {
      this.shards[i].terminate();
    }
  };


  var sabProxy = function(w, h, shards) {
    this.w = w;
    this.h = h;
    this.shardCount = shards;

    this.shards = [];

    this.broadcast = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
    this.fb = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
    this.reply = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
    this.u = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));
    this.v = new fluid.Buffer(w, h, new Float32Array(new ArrayBuffer(w * h * 4, true)));

    this.control = new ArrayBuffer(fluid.control.size, true);
    this.control.mutexInit(fluid.control.lock);
    this.control.condInit(fluid.control.workerWait);
    this.control.condInit(fluid.control.mainWait);
    this.control.barrierInit(fluid.control.workerBarrier);
    this.control.mutexInit(fluid.control.barrierMutex);
    this.control.condInit(fluid.control.barrierSemiphore);


    this.controlMem = new Uint8Array(this.control);
    this.controlFloat = new Float32Array(this.control);
    this.controlUint = new Uint32Array(this.control);

    this.controlUint[fluid.control.barrierMax>>2] = shards;
    this.controlUint[fluid.control.barrierCurrent>>2] = 0;
  };

  sabProxy.prototype = new genericProxy();

  sabProxy.prototype.init = function() {
    var proxy = this;

    this.control.mutexLock(fluid.control.lock);
    this.controlMem[fluid.control.command] = fluid.control.INIT;
    this.controlMem[fluid.control.running] = this.shardCount;
    this.control.mutexUnlock(fluid.control.lock);

    this.main = new RPCWorker(new Worker('simulation.js'));
    this.main.rpc("initMain", {control: this.control}, undefined, [this.control]);

    this.main.initialized = false;

    for (var i = 0; i < this.shardCount; i++) {
      var shard = new RPCWorker(new Worker('simulation.js'));
      shard.rpc(
        "initSAB",
        {
          w: this.w,
          h: this.h,
          workerID: i,
          shards: this.shardCount,
          broadcast: fluid.marshalFloat32Array(this.broadcast.data),
          fb: fluid.marshalFloat32Array(this.fb.data),
          reply: fluid.marshalFloat32Array(this.reply.data),
          u: fluid.marshalFloat32Array(this.u.data),
          v: fluid.marshalFloat32Array(this.v.data),
          control: this.control,
        },
        undefined,
        [
          this.broadcast.data.buffer,
          this.fb.data.buffer,
          this.reply.data.buffer,
          this.u.data.buffer,
          this.v.data.buffer,
          this.control,
        ]
      );
      this.shards.push(shard);
    }
  };

  sabProxy.prototype.updateVelocity = function(u, v) {
    if (!this.alive) throw "dead proxy";
    this.u.data.set(u.data);
    this.v.data.set(v.data);
  };

  sabProxy.prototype.jacobi = function(inp, out, jparams) {
    if (!this.alive) throw "dead proxy";
    var proxy = this;

    return Promise.resolve(undefined).then(function() {
      proxy.broadcast.copy(inp);
      return proxy.sendCommand(fluid.control.JACOBI, jparams);
    }).then(function() {
      out.copy(proxy.reply);
    });


    return new Promise(function(resolve) {
      proxy.broadcast.copy(inp);
      var remaining = proxy.shards.length;
      for (var i = 0; i < remaining; i++) {
        (function(i) {
          proxy.shards[i].rpc(
            "shardedJacobiRO",
            {
              params: jparams
            },
            function(result) {
              remaining -= 1;
              if (remaining <= 0) {
                out.copy(proxy.reply);
                resolve();
              }
            }
          );
        })(i);
      }
    });
  };

  sabProxy.prototype.sendCommand = function(cmd, args) {
    var proxy = this;

    if (proxy.initialized) {
      if (cmd == fluid.control.JACOBI) {
        fluid.sendJacobiCommand(args, proxy.control, proxy.controlMem, proxy.controlFloat);
      } else if (cmd == fluid.control.QUIT) {
        fluid.sendQuitCommand(proxy.control, proxy.controlMem);
      } else {
        console.error(cmd);
        throw cmd;
      }
      return;
    }

    return new Promise(function(resolve) {
      if (cmd == fluid.control.JACOBI) {
        //var begin = performance.now();
        proxy.main.rpc(
          "jacobiMain",
          args,
          function(result) {
            proxy.initialized = true;
            //var outside = performance.now() - begin;
            //console.log(outside, result.time, outside - result.time);
            resolve();
          }
        )
      } else if (cmd == fluid.control.QUIT) {
        console.log("Sending quit.");
        proxy.main.rpc(
          "quitMain",
          args,
          function() {
            proxy.initialized = true;
            console.log("Quit done.");
            resolve();
          }
        )
      } else {
        console.error(cmd);
        throw cmd;
      }
    });
  };

  sabProxy.prototype.shutdown = function() {
    if (!this.alive) throw "dead proxy";
    this.alive = false;

    var proxy = this;
    return Promise.resolve(undefined).then(function() {
      return proxy.sendCommand(fluid.control.QUIT, {});
    }).then(function() {
      console.log("terminating.");
      for (var i = 0; i < proxy.shards.length; i++) {
        proxy.shards[i].terminate();
      }
      proxy.main.terminate();

      console.log("destroying.");

      proxy.control.condDestroy(fluid.control.barrierSemiphore);
      proxy.control.mutexDestroy(fluid.control.barrierMutex);
      proxy.control.barrierDestroy(fluid.control.workerBarrier);
      proxy.control.condDestroy(fluid.control.mainWait);
      proxy.control.condDestroy(fluid.control.workerWait);
      proxy.control.mutexDestroy(fluid.control.lock);
    });
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


    var readonly = config.proxy == "readonly";

    return Promise.resolve(undefined).then(function() {
      if (state.pending) {
        state.pending.cancel();
      }

      if (state.proxy) {
        return state.proxy.shutdown();
      }
    }).then(function() {
      if (config.proxy == "shared") {
        state.proxy = new sabProxy(state.width, state.height, config.shards);
      } else if (config.proxy == "remote" || readonly) {
        state.proxy = new remoteProxy(state.width, state.height, config.shards, readonly);
      } else {
        state.proxy = new localProxy(state.width, state.height);
      }
    }).then(function() {
      return state.proxy.init();
    }).then(function() {
      state.proxy.updateVelocity(state.u, state.v);

      genNoise(state);

      for (var i = 0; i < 100; i++) {
        splat(state);
      }

      runner.scheduleFrame();
    });
  };

  exports.runFluid = function() {
    // Minimize a V8 inlining bug.
    if (window.gc) {
      gc();
    }

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


    var rbutton = document.createElement("input");
    rbutton.type = "button";
    rbutton.value = "Reload";
    rbutton.onclick = function() {
      var url = window.location.pathname;
      if (url[url.length - 1] == "/") {
        url += "index.html"
      }
      var query = schema.encode(config);
      if (query) {
        url += "?" + query;
      }
      window.location.replace(url);
    };
    document.body.appendChild(rbutton);

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
      proxies.push("shared");
    }
    gui.add(config, "proxy", proxies).onFinishChange(syncConfig);
    gui.add(config, "shards", [1, 2, 4, 8, 16]).onFinishChange(syncConfig);

    document.body.appendChild(gui.domElement);
  };

  var schema = new demolition.SettingsSchema();
  schema.number("diffuse", 0.000002);
  schema.number("drag", 0);
  schema.number("tiles", 2);
  schema.bool("show_debug", false);
  schema.bool("single_step", false);

  schema.number("shards", 4);
  schema.string("proxy", "local");

  var config = schema.decode(demolition.parseQuery());

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
