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

  var diffuse = function(inp, out, dx, diff, drag, dt) {
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
      return state.proxy.jacobi(inp, out, jparams);
    });
  };

  var project = function(state) {
    var scale = 0.5;
    return Promise.resolve(undefined).then(function() {
      return state.proxy.calcDiv(state.div, scale);
    }).then(function() {
      return state.proxy.zero(state.p);
    }).then(function() {
      var jparams = {
        iterations: 30,
        a: -1,
        invB: 1/4,
      };
      return Promise.resolve(undefined).then(function() {
        return state.proxy.jacobi(state.div, state.p, jparams);
      });
    }).then(function() {
      return state.proxy.subtractPressure(state.p, state.u, state.v, scale);
    }).then(function() {
      return state.proxy.updateVelocity(state.u, state.v);
    });
  };

  var advectColor = function(state, dt) {
    // Advect the density.
    var din = state.r;
    var dout = state.temp0;

    return Promise.resolve(undefined).then(function() {
      return state.proxy.advect(din, dout, dt);
    }).then(function() {
      state.r = dout;
      state.temp0 = din;
      din = state.g;
      dout = state.temp0;
    }).then(function() {
      return state.proxy.advect(din, dout, dt);
    }).then(function() {
      state.g = dout;
      state.temp0 = din;
      din = state.b;
      dout = state.temp0;
    }).then(function() {
      return state.proxy.advect(din, dout, dt);
    }).then(function() {
      state.b = dout;
      state.temp0 = din;
    });
  };

  var updateVelocity = function(state) {
    // Swap the buffers.
    var temp = state.u;
    state.u = state.temp0;
    state.temp0 = temp;

    temp = state.v;
    state.v = state.temp1;
    state.temp1 = temp;

    // Broadcast.
    return state.proxy.updateVelocity(state.u, state.v);
  };

  var simulateFluid = function(state, dt) {
    if (dt == 0) {
      return;
    }
    dt *= 10;

    return Promise.resolve(undefined).then(function() {
      return advectColor(state, dt);
    }).then(function() {
      if (config.diffuse != 0) {
        // Diffuse the velocity.
        return Promise.resolve(undefined).then(function() {
          return diffuse(state.u, state.temp0, state.dx, config.diffuse, config.drag, dt);
        }).then(function() {
          return diffuse(state.v, state.temp1, state.dx, config.diffuse, config.drag, dt);
        }).then(function() {
          return updateVelocity(state);
        }).then(function() {
          // Correct the diffused velocity.
          return project(state);
        });
      }

    }).then(function() {
      // Advect the velocity.
      return Promise.resolve(undefined).then(function() {
        return state.proxy.advect(state.u, state.temp0, dt);
      }).then(function() {
        return state.proxy.advect(state.v, state.temp1, dt);
      }).then(function() {
        return updateVelocity(state);
      })
    }).then(function() {
      // Correct the avected velocity.
      return project(state);
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
  };

  var autoSplat = function(dt) {
    state.phase = state.phase + dt;
    while (state.phase >= 1.0) {
      splat(state);
      state.phase -= 1.0;
    }
  };

  var frame = function(dt) {
    Promise.resolve(undefined).then(function() {
      autoSplat(dt);
    }).then(draw).then(function() {
      simTime.begin();
    }).then(function() {
      return simulateFluid(state, dt);
    }).then(function() {
      simTime.end();
      runner.scheduleFrame();
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
  };

  localProxy.prototype.updateVelocity = function(u, v) {
    this.u = u;
    this.v = v;
  };

  localProxy.prototype.advect = function(inp, out, scale) {
    fluid.advect(inp, out, this.u, this.v, scale);
  };

  localProxy.prototype.calcDiv = function(div, scale) {
    fluid.calcDiv(this.u, this.v, div, scale);
  };

  localProxy.prototype.subtractPressure = function(p, u, v, scale) {
    fluid.subtractPressure(p, u, v, scale);
  };

  localProxy.prototype.jacobi = function(inp, out, jparams) {
    fluid.jacobi(inp, this.fb, out, jparams);
  };

  localProxy.prototype.zero = function(data) {
    fluid.zero(data);
  };

  localProxy.prototype.shutdown = function() {
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

    state.proxy = new localProxy(state.width, state.height);
    state.proxy.updateVelocity(state.u, state.v);

    genNoise(state);

    for (var i = 0; i < 10; i++) {
      splat(state);
    }
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

    var gui = new dat.GUI({autoPlace: false});

    gui.add(config, "diffuse", 0, 0.00001);
    gui.add(config, "drag", 0, 0.1);
    gui.add(config, "tiles", [2, 4, 8, 16]).onFinishChange(syncConfig);
    gui.add(config, "show_debug");

    //gui.add(config, "shards", 1, 8).step(1).onFinishChange(syncConfig);
    //gui.add(config, "proxy", ["local", "copy", "transfer", "shared"]).onFinishChange(syncConfig);

    document.body.appendChild(gui.domElement);

    // Simulation timer.
    document.body.appendChild(simTime.domElement);

    runner.scheduleFrame();
  };

  var Config = function() {
    this.diffuse = 0.000002;
    this.drag = 0;
    this.tiles = 2;
    this.show_debug = false;

    this.shards = 4;
    this.proxy = "transfer";
  };

  var config = new Config();

  var simTime = new Stats();
  simTime.setMode(1);

  var state = {};

  var runner = new demolition.DemoRunner();
  runner.onFrame(frame).autoPump(false);
})(window);
