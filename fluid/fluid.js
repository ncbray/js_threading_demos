"use strict";
(function(exports) {
  var genNoise = function() {
    var r = state.r;
    var g = state.g;
    var b = state.b;

    var u = state.u;
    var v = state.v;

    var noise = 0.01;

    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = j * state.width + i;

        r[base] = 0.5;
        g[base] = 0.5;
        b[base] = 0.5;

        var nx = i/state.width;
        var ny = j/state.height;

        // Circular motion
        u[base] = (ny - 0.5);
        v[base] = -(nx - 0.5);

        //u[base] = Math.cos(ny * 2 * Math.PI * 5) + (Math.random() * noise * 2 - noise);
        //v[base] = Math.sin(nx * 2 * Math.PI * 3) + (Math.random() * noise * 2 - noise);
      }
    }
  };

  // Fluid simulation based on:
  // http://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf

  var index = function(state, x, y) {
    x = x & state.wmask;
    y = y & state.hmask;
    return (y << state.wshift) | x;
  };

  var sample = function(state, inp, x, y) {
    var lx = Math.floor(x);
    var bx = x - lx;
    var ly = Math.floor(y);
    var by = y - ly;

    var s00 = inp[index(state, lx, ly)];
    var s10 = inp[index(state, lx+1, ly)];

    var s01 = inp[index(state, lx, ly+1)];
    var s11 = inp[index(state, lx+1, ly+1)];

    var s0 = demolition.blend(s00, s10, bx);
    var s1 = demolition.blend(s01, s11, bx);
    var s = demolition.blend(s0, s1, by);
    return s;
  };

  var advectBlock = function(state, inp, out, u, v, startX, endX, startY, endY, scale) {
    for (var j = startY; j < endY; j++) {
      for (var i = startX; i < endX; i++) {
        var base = index(state, i, j);
        out[base] = sample(state, inp, i-u[base]*scale, j-v[base]*scale);
      }
    }
  };

  var advect = function(state, inp, out, scale) {
    var block = 32;
    for (var j = 0; j < state.height; j = j + block) {
      for (var i = 0; i < state.width; i = i + block) {
        advectBlock(state, inp, out, state.u, state.v, i, i+block, j, j+block, scale);
      }
    }
  };

  var diffuse = function(state, buffers, dt) {
    var diff = 0.00000002;
    var invA = (dt * diff * state.width * state.height);
    if (invA == 0) {
      return;
    }
    var a = 1 / invA;
    var invB = 1/(4 + a);

    // For the first iteration, have the feedback be the input.
    var temp = buffers.fb;
    buffers.fb = buffers.inp;
    jacobiIteration(state, buffers.inp, buffers.fb, buffers.out, a, invB);
    buffers.fb = temp;

    for (var k = 1; k < 20; k++) {
      var temp = buffers.fb;
      buffers.fb = buffers.out;
      buffers.out = temp;
      jacobiIteration(state, buffers.inp, buffers.fb, buffers.out, a, invB);
    }
  };

  var jacobiIteration = function(state, inp, fb, out, a, invB) {
    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = index(state, i, j);
        out[base] = (a * inp[base] +
            fb[index(state, i-1, j)] +
            fb[index(state, i+1, j)] +
            fb[index(state, i, j-1)] +
            fb[index(state, i, j+1)]
        ) * invB;
      }
    }
  };

  var project = function(state, buffers, dt) {
    var u = buffers.u;
    var v = buffers.v;
    var div = buffers.div;
    var p = buffers.p;
    var fb = buffers.fb;
    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        div[index(state, i, j)] = -0.5 * (
            u[index(state, i + 1, j)] -
            u[index(state, i - 1, j)] +
            v[index(state, i, j + 1)] -
            v[index(state, i, j - 1)]
        );
        p[index(state, i, j)] = 0;
        fb[index(state, i, j)] = 0;
      }
    }



    for (var k = 0; k < 20; k++) {
      var temp = fb;
      fb = p;
      p = temp;
      for (var j = 0; j < state.height; j++) {
        for (var i = 0; i < state.width; i++) {
          var base = index(state, i, j);
          // TODO correct scale factor?
          p[base] = (div[base] + fb[index(state, i - 1, j)] + fb[index(state, i + 1, j)] + fb[index(state, i, j - 1)] + fb[index(state, i, j + 1)]) * 0.25;
        }
      }
    }

    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = index(state, i, j);
        u[base] -= 0.5 * (p[index(state, i + 1, j)] - p[index(state, i - 1, j)])
        v[base] -= 0.5 * (p[index(state, i, j + 1)] - p[index(state, i, j - 1)])
      }
    }

    buffers.p = p;
    buffers.fb = fb;
  };

  var simulateFluid = function(dt) {
    dt *= 10;

    // Advect the density.
    var din = state.r;
    var dout = state.temp0;
    advect(state, din, dout, dt);
    state.r = dout;
    state.temp0 = din;

    din = state.g;
    dout = state.temp0;
    advect(state, din, dout, dt);
    state.g = dout;
    state.temp0 = din;

    din = state.b;
    dout = state.temp0;
    advect(state, din, dout, dt);
    state.b = dout;
    state.temp0 = din;

    var buffers = {};

    // Diffuse the velocity.
    buffers.inp = state.u;
    buffers.fb = state.temp0;
    buffers.out = state.temp1;
    diffuse(state, buffers, dt);
    state.u = buffers.out;
    state.temp0 = buffers.inp;
    state.temp1 = buffers.fb;

    buffers.inp = state.v;
    buffers.fb = state.temp0;
    buffers.out = state.temp1;
    diffuse(state, buffers, dt);
    state.v = buffers.out;
    state.temp0 = buffers.inp;
    state.temp1 = buffers.fb;


    // Correct the diffused velocity.
    doProject(state, dt);

    //advect(state, state.u, state.p, dt*0);

    if (true) {
      var u0 = state.u;
      var v0 = state.v;

      var u1 = state.temp0;
      var v1 = state.temp1;

      var hype = 1.0;
      advect(state, u0, u1, dt*hype);
      advect(state, v0, v1, dt*hype);

      state.u = u1;
      state.v = v1;

      state.temp0 = u0;
      state.temp1 = v0;

      // Correct the avected velocity.
      doProject(state, dt);
    }
  };

  var doProject = function(state, dt) {
    var buffers = {};
    buffers.u = state.u;
    buffers.v = state.v;
    buffers.div = state.div;
    buffers.p = state.p;
    buffers.fb = state.temp0;
    project(state, buffers, dt);
    state.div = buffers.div;
    state.p = buffers.p;
    state.temp0 = buffers.fb;
  };

  var drawData = function(state, inp, scale, offset) {
    var out = state.pixelInts;

    for (var j = 0; j < state.height; j++) {
      for (var i = 0; i < state.width; i++) {
        var base = j * state.width + i;
        var value = demolition.linearToByte(inp[base]*scale+offset);
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
        var rv = demolition.linearToByte(r[base]*scale+offset);
        var gv = demolition.linearToByte(g[base]*scale+offset);
        var bv = demolition.linearToByte(b[base]*scale+offset);
        out[base] = demolition.byteColorToInt(rv, gv, bv);
      }
    }
    state.buffer.data.set(state.pixelBytes);
    return state.buffer;
  };


  var drawCircle = function(state, data, x, y, r0, r1, c) {
    for (var j = -r1; j <= r1; j++) {
      for (var i = -r1; i <= r1; i++) {
        var d2 = i*i + j*j;
        if (d2 > r1 *r1) {
          continue
        }
        var base = index(state, x+i, y+j);
        var existing = data[base];
        var a = 1 - demolition.smoothstep(r0*r0, r1*r1, d2);
        data[base] = demolition.blend(existing, c, a * 0.9);
      }
    }
  };

  var splat = function() {
    var x = (Math.random() * state.width)|0;
    var y = (Math.random() * state.height)|0;
    var r0 = (10 + Math.random() * 30)|0;
    var r1 = r0 + 1;
    var c = Math.random();
    drawCircle(state, state.r, x, y, r0, r1, c);
    c = Math.random();
    drawCircle(state, state.g, x, y, r0, r1, c);
    c = Math.random();
    drawCircle(state, state.b, x, y, r0, r1, c);
  };

  var frame = function(dt) {
    state.phase = state.phase + dt;
    while (state.phase >= 1.0) {
      splat();
      state.phase -= 1.0;
    }

    simulateFluid(dt);

    var d = drawRGBData(state, state.r, state.g, state.b, 1, 0);

    var ctx = state.ctx;
    for (var j = 0; j < state.tile; j++) {
      for (var i = 0; i < state.tile; i++) {
        ctx.putImageData(d, (i * state.width)|0, (j * state.height)|0);
      }
    }


    if (true) {
      var u = drawData(state, state.u, 0.2, 0.5);
      ctx.putImageData(u, state.width, 0);

      var v = drawData(state, state.v, 0.2, 0.5);
      ctx.putImageData(v, state.width, state.height);

      var p = drawData(state, state.p, 0.2, 0.5);
      ctx.putImageData(p, 0, state.height);
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


    var hype = 0.1;
    var steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2 + 1;

    for (var i = 0; i < steps; i++) {
      var base = index(state, demolition.blend(x, state.mouseX, i/steps), demolition.blend(y, state.mouseY, i/steps));
      drawCircle(state, state.u, state.mouseX, state.mouseY, 2, 7, vx * hype);
      drawCircle(state, state.v, state.mouseX, state.mouseY, 2, 7, vy * hype);
    }

    state.mouseX = x;
    state.mouseY = y;
    state.mouseTime = t;
  };

  exports.runFluid = function() {
    var c = document.getElementsByTagName("canvas")[0];
    state.tile = 2;
    state.width = (+c.width / state.tile)|0;
    state.height = (+c.height / state.tile)|0;

    state.wshift = (Math.log(state.width)/Math.LN2)|0;
    state.wmask = (state.width-1)|0;
    state.hmask = (state.height-1)|0;

    console.log(state.wmask, state.hmask, state.wshift)

    state.ctx = c.getContext("2d");
    state.buffer = state.ctx.createImageData(state.width, state.height);

    state.phase = 0;

    // Simulation
    state.r = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.g = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.b = new Float32Array(new ArrayBuffer(state.width * state.height * 4));

    state.u = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.v = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.div = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.p = new Float32Array(new ArrayBuffer(state.width * state.height * 4));


    state.temp0 = new Float32Array(new ArrayBuffer(state.width * state.height * 4));
    state.temp1 = new Float32Array(new ArrayBuffer(state.width * state.height * 4));

    // Buffer for simulation => pixel conversion
    state.pixelData = new ArrayBuffer(state.width * state.height * 4);
    state.pixelBytes = new Uint8ClampedArray(state.pixelData);
    state.pixelInts = new Uint32Array(state.pixelData);

    genNoise();

    state.mouseX = 0;
    state.mouseY = 0;
    state.mouseTime = -1000000;

    c.addEventListener('mousemove', function(e) {
      mouseMove(e.offsetX === undefined ? e.layerX : e.offsetX, e.offsetY === undefined ? e.layerY : e.offsetY);
    });

    runner.scheduleFrame();
  };

  var state = {};

  var runner = new demolition.DemoRunner();
  runner.onFrame(frame);
})(window);