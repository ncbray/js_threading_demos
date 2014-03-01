"use strict";

(function(exports){
  // Copied from utility library
  var loadShader = function(gl, shaderSource, shaderType, opt_errorCallback) {
    var errFn = opt_errorCallback || error;
    // Create the shader object
    var shader = gl.createShader(shaderType);

    // Load the shader source
    gl.shaderSource(shader, shaderSource);

    // Compile the shader
    gl.compileShader(shader);

    // Check the compile status
    var compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      // Something went wrong during compilation; get the error
      lastError = gl.getShaderInfoLog(shader);
      errFn("*** Error compiling shader '" + shader + "':" + lastError);
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }
  var loadProgram = function(
    gl, shaders, opt_attribs, opt_locations, opt_errorCallback) {
    var errFn = opt_errorCallback || error;
    var program = gl.createProgram();
    for (var ii = 0; ii < shaders.length; ++ii) {
      gl.attachShader(program, shaders[ii]);
    }
    if (opt_attribs) {
      for (var ii = 0; ii < opt_attribs.length; ++ii) {
        gl.bindAttribLocation(
          program,
          opt_locations ? opt_locations[ii] : ii,
          opt_attribs[ii]);
      }
    }
    gl.linkProgram(program);

    // Check the link status
    var linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linked) {
      // something went wrong with the link
      lastError = gl.getProgramInfoLog (program);
      errFn("Error in program linking:" + lastError);

      gl.deleteProgram(program);
      return null;
    }
    return program;
  };

  var vshader = " \
attribute vec4 a_vertex; \
void main() { \
gl_PointSize = 1.5; \
gl_Position = a_vertex * 2.0 - 1.0; \
} \
";

  var fshader = " \
precision mediump float; \
void main() { \
gl_FragColor = vec4(0.2, 0.2, 0.4, 1.0); \
} \
";

  var simulateShard = function(i, dt) {
    var simulator = state.simulators[i];
    simulator.simulate(dt, config.substeps, function(p) {
      // Upload
      var gl = state.ctx;
      gl.bindBuffer(gl.ARRAY_BUFFER, state.pBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, i * state.simBytes, p);

      simulator.restore(p.buffer);

      state.waiting -= 1;
      if (state.waiting <= 0) {
        simTime.end();
        runner.scheduleFrame();
      }
    });
  }

  var simulate = function(dt) {
    if (state.waiting) {
      return;
    }
    simTime.begin();
    state.waiting = state.simulators.length;
    for (var i = 0; i < state.simulators.length; i++) {
      simulateShard(i, dt);
    }
  }

  var frame = function(dt) {
    // Slow down
    dt *= 0.2;

    simulate(dt);

    // Animate
    state.phase += dt / 8;
    state.phase %= 1.0;
    draw();
  }

  var draw = function() {
    var gl = state.ctx;

    // Draw the background
    var red = (0.5 * Math.cos(state.phase * Math.PI * 2) + 0.5);
    red = demolition.linearToGamma(red * 0.2 + 0.05);
    var blue = (0.5 * Math.sin(state.phase * Math.PI * 2) + 0.5);
    blue = demolition.linearToGamma(blue * 0.2 + 0.05);
    gl.clearColor(red, 0.0, blue, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    // Draw the particles
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.blendFunc(gl.DST_ALPHA, gl.ONE);

    gl.useProgram(state.prog);


    gl.bindBuffer(gl.ARRAY_BUFFER, state.pBuf);

    var vLoc = gl.getAttribLocation(state.prog, "a_vertex");
    gl.vertexAttribPointer(vLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vLoc);

    gl.drawArrays(gl.POINTS, 0, state.n);
  };

  var syncConfig = function() {
    var shards = config.shards;
    var n = config.particles;
    var shardN = (n / shards)|0;
    n = shardN * shards;

    state.n = n;
    state.simBytes = shardN * 4 * 2;
    state.totalBytes = state.simBytes * shards;

    for (var i = 0; i < state.simulators.length; i++) {
      state.simulators[i].destroy();
    }

    state.simulators = [];
    state.waiting = 0;

    var proxyType = localProxy;
    if (config.proxy != "local") {
      proxyType = workerProxy;
    }
    if (config.proxy == "shared") {
      proxyType = sharedMemoryProxy;
    }

    var transfer = config.proxy != "copy";

    for (var i = 0; i < shards; i++) {
      var proxy = new proxyType(n / shards, transfer);
      state.simulators.push(proxy);
    }

    var gl = state.ctx;
    var pBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.totalBytes, gl.STREAM_DRAW);
    state.pBuf = pBuf;

    runner.scheduleFrame();
  }

  var run = function() {
    var c = document.getElementsByTagName("canvas")[0];
    state.width = +c.width;
    state.height = +c.height;
    state.phase = 0;

    var gl = getWebGLContext(c);
    state.ctx = gl;
    var vs = loadShader(gl, vshader, gl.VERTEX_SHADER, function(err) {console.log(err)});
    var fs = loadShader(gl, fshader, gl.FRAGMENT_SHADER, function(err) {console.log(err)});
    var prog = loadProgram(gl, [vs, fs], undefined, undefined, function(err) {console.log(err)});

    state.prog = prog;

    syncConfig();

    document.body.appendChild(simTime.domElement);

    var gui = new dat.GUI({autoPlace: false});
    gui.add(config, "particles", 50000, 200000).step(10000).onFinishChange(syncConfig);
    gui.add(config, "substeps", 1, 32).step(1);
    gui.add(config, "shards", 1, 8).step(1).onFinishChange(syncConfig);
    gui.add(config, "proxy", ["local", "copy", "transfer", "shared"]).onFinishChange(syncConfig);
    document.body.appendChild(gui.domElement);
  };

  var localProxy = function(n) {
    this.state = initSimulation(n);
  };

  localProxy.prototype.simulate = function(dt, substeps, callback) {
    this.state.asyncSimulate(dt, substeps, callback);
  };

  localProxy.prototype.restore = function(buffer) {
  };

  localProxy.prototype.destroy = function() {
  };


  var workerProxy = function(n, transfer) {
    this.alive = true;
    this.transfer = transfer;
    this.worker = new Worker('simulate.js');
    this.worker.postMessage({type: "init", n: n, transfer: transfer, shared: false});
    this.callback = null;

    var proxy = this;
    this.worker.addEventListener("message", function(e) {
      proxy.callback(e.data);
    }, false);
  };

  workerProxy.prototype.simulate = function(dt, substeps, callback) {
    if (this.alive) {
      this.callback = callback;
      this.worker.postMessage({type: "simulate", dt: dt, substeps: substeps});
    }
  };

  workerProxy.prototype.restore = function(buffer) {
    if (this.alive && this.transfer) {
      this.worker.postMessage({type: "restore", buffer: buffer}, [buffer]);
    }
  };

  workerProxy.prototype.destroy = function() {
    this.alive = false;
    this.worker.terminate();
  };


  var sharedMemoryProxy = function(n, transfer) {
    this.alive = true;
    this.transfer = transfer;
    this.worker = new Worker('simulate.js');
    this.worker.postMessage({type: "init", n: n, transfer: true, shared: true});
    this.callback = null;

    var proxy = this;
    this.worker.addEventListener("message", function(e) {
      proxy.callback(e.data);
    }, false);
  };

  sharedMemoryProxy.prototype.simulate = function(dt, substeps, callback) {
    if (this.alive) {
      this.callback = callback;
      this.worker.postMessage({type: "simulate", dt: dt, substeps: substeps});
    }
  };

  sharedMemoryProxy.prototype.restore = function(buffer) {
  };

  sharedMemoryProxy.prototype.destroy = function() {
    this.alive = false;
    this.worker.terminate();
  };


  var Config = function() {
    this.particles = 100000;
    this.substeps = 16;
    this.shards = 4;
    this.proxy = "transfer";
  };

  var simTime = new PerfTracker("Sim", 200, 60);

  var config = new Config();

  var state = {simulators: []};

  var runner = new demolition.DemoRunner();
  runner.maxDelta(0.25).onFrame(frame).autoPump(false);

  exports.runSoup = run;

})(window);
