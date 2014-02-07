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

  var diffuse = function(buffers, dx, diff, drag, dt) {
    // The input is a good inital approximation of the output.
    buffers.out.copy(buffers.inp);

    var denomA = dt * diff;
    if (denomA == 0) {
      return;
    }
    var a = dx * dx / denomA;
    var drag = Math.pow(1-drag, dt);

    var jparams = {
      inp: buffers.inp,
      fb: buffers.fb,
      out: buffers.out,
      iterations: 30,
      a: a,
      invB: drag / (4 + a),
    };
    jacobi(jparams);

    buffers.fb = jparams.fb;
    buffers.out = jparams.out;
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

  var jacobiIteration = function(params) {
    var inp = params.inp;
    var fb = params.fb;
    var out = params.out;

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

  var jacobi = function(params) {
    // It is assumed that buffers.out is initialized to a reasonable prediction.
    // buffers.out will become the first feedback buffer.
    for (var k = 0; k < params.iterations; k++) {
      var temp = params.fb;
      params.fb = params.out;
      params.out = temp;
      jacobiIteration(params);
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

  var project = function(buffers) {
    var u = buffers.u;
    var v = buffers.v;
    var div = buffers.div;
    var p = buffers.p;
    var fb = buffers.fb;

    var scale = 0.5;

    calcDiv(u, v, div, scale);

    zero(p);
    var jparams = {
      inp: div,
      fb: fb,
      out:p,
      iterations: 30,
      a: -1,
      invB: 1/4,
    };
    jacobi(jparams);
    fb = jparams.fb;
    p = jparams.out;

    buffers.p = p;
    buffers.fb = fb;

    subtractPressure(p, u, v, scale);
  };

  var simulateFluid = function(dt) {
    if (dt == 0) {
      return;
    }
    dt *= 10;

    // Advect the density.
    var din = state.r;
    var dout = state.temp0;

    advect(din, dout, state.u, state.v, dt);
    state.r = dout;
    state.temp0 = din;

    din = state.g;
    dout = state.temp0;
    advect(din, dout, state.u, state.v, dt);
    state.g = dout;
    state.temp0 = din;

    din = state.b;
    dout = state.temp0;
    advect(din, dout, state.u, state.v, dt);
    state.b = dout;
    state.temp0 = din;

    var buffers = {};

    if (config.diffuse != 0) {
      // Diffuse the velocity.
      buffers.inp = state.u;
      buffers.fb = state.temp0;
      buffers.out = state.temp1;
      diffuse(buffers, state.dx, config.diffuse, config.drag, dt);
      state.u = buffers.out;
      state.temp0 = buffers.inp;
      state.temp1 = buffers.fb;

      buffers.inp = state.v;
      buffers.fb = state.temp0;
      buffers.out = state.temp1;
      diffuse(buffers, state.dx, config.diffuse, config.drag, dt);
      state.v = buffers.out;
      state.temp0 = buffers.inp;
      state.temp1 = buffers.fb;

      // Correct the diffused velocity.
      doProject(state);
    }

    // Advect the velocity.
    var u0 = state.u;
    var v0 = state.v;

    var u1 = state.temp0;
    var v1 = state.temp1;

    advect(u0, u1, u0, v0, dt);
    advect(v0, v1, u0, v0, dt);

    state.u = u1;
    state.v = v1;

    state.temp0 = u0;
    state.temp1 = v0;

    // Correct the avected velocity.
    doProject(state);
  };

  var doProject = function(state) {
    var buffers = {};
    buffers.u = state.u;
    buffers.v = state.v;
    buffers.div = state.div;
    buffers.p = state.p;
    buffers.fb = state.temp0;
    project(buffers);
    state.div = buffers.div;
    state.p = buffers.p;
    state.temp0 = buffers.fb;
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

  var frame = function(dt) {
    state.phase = state.phase + dt;
    while (state.phase >= 1.0) {
      splat(state);
      state.phase -= 1.0;
    }

    simTime.begin();
    simulateFluid(dt);
    simTime.end();

    var d = drawRGBData(state, state.r, state.g, state.b, 1, 0);

    var ctx = state.ctx;
    for (var j = 0; j < state.tile; j++) {
      for (var i = 0; i < state.tile; i++) {
        ctx.putImageData(d, (i * state.width)|0, (j * state.height)|0);
      }
    }

    if (config.show_all) {
      var u = drawData(state, state.u, 0.2, 0.5);
      ctx.putImageData(u, state.width * (state.tile - 1), state.height * (state.tile - 2));

      var v = drawData(state, state.v, 0.2, 0.5);
      ctx.putImageData(v, state.width * (state.tile - 2), state.height * (state.tile - 1));

      var p = drawData(state, state.p, 0.2, 0.5);
      ctx.putImageData(p, state.width * (state.tile - 1), state.height * (state.tile - 1));
    }
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


  var createBuffer = function(w, h) {
    return new Buffer(w, h);
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
    gui.add(config, "show_all");

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
    this.show_all = false;

    this.shards = 4;
    this.proxy = "transfer";
  };

  var config = new Config();

  var simTime = new Stats();
  simTime.setMode(1);

  var state = {};

  var runner = new demolition.DemoRunner();
  runner.onFrame(frame);
})(window);