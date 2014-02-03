(function(exports) {
  var accel = function(s) {
    var cx = 0.5;
    var cy = 0.5;
    var dx = s.px - cx;
    var dy = s.py - cy;

    s.ax = -dx * 2;
    s.ay = -dy * 2;
  }

  var simulateStep = function(state, dt) {
    var n = state.n;
    var p = state.p;
    var v = state.v;

    var s = {px: 0, py: 0, vx: 0, vy: 0, ax: 0, ay: 0};
    for (var i = 0; i < n; i++) {
      var px = p[i*2+0];
      var py = p[i*2+1];
      var vx = v[i*2+0];
      var vy = v[i*2+1];

      // Improved Euler / RK2
      s.px = px;
      s.py = py;
      s.vx = vx;
      s.vy = vy;
      accel(s);
      var ax = s.ax;
      var ay = s.ay;
      s.px += vx * dt;
      s.py += vy * dt;
      s.vx += s.ax * dt;
      s.vy += s.ay * dt;
      accel(s);

      px += (vx + s.vx) * dt * 0.5;
      py += (vy + s.vy) * dt * 0.5;

      vx += (ax + s.ax) * dt * 0.5;
      vy += (ay + s.ay) * dt * 0.5;

      // Collision
      if (px <= 0 && vx < 0) {
        vx = -vx;
      } else if (px >= 1 && vx > 0) {
        vx = -vx;
      }
      if (py <= 0 && vy < 0) {
        vy = -vy;
      } else if (py >= 1 && vy > 0) {
        vy = -vy;
      }

      p[i*2+0] = px;
      p[i*2+1] = py;
      v[i*2+0] = vx;
      v[i*2+1] = vy;
    }
  }

  var simulate = function(dt, substeps) {
    for (var i = 0; i < substeps; i++) {
      simulateStep(this, dt / substeps);
    }
  }

  var asyncSimulate = function(dt, substeps, callback) {
    this.simulate(dt, substeps);
    // Present the data
    callback(this.p);
  }

  var setBuffer = function(buffer) {
    this.buffer = buffer;
    this.p = new Float32Array(buffer, 0, this.n * 2);
    this.v = new Float32Array(buffer, this.n * 4 * 2, this.n * 2);
  }

  var initSimulation = function(n, shared) {
    var state = {n: n, setBuffer: setBuffer};

    var buffer = new ArrayBuffer(n * 4 * 2 * 2, shared);
    state.setBuffer(buffer);

    var p = state.p;
    var v = state.v;

    for (var i = 0; i < n; i++) {
      p[i*2+0] = Math.random();
      p[i*2+1] = Math.random();

      var angle = Math.random() * Math.PI * 2;
      var speed = 0.3;
      v[i*2+0] = Math.cos(angle) * speed;
      v[i*2+1] = Math.sin(angle) * speed;
    }

    state.p = p;
    state.v = v;
    state.simulate = simulate;
    state.asyncSimulate = asyncSimulate;

    return state;
  }

  exports.initSimulation = initSimulation;
})(this.window || this.self);

if (this.self !== undefined) {
  var state;
  self.addEventListener('message', function(e) {
    var m = e.data;
    if (m.type == "init") {
      state = initSimulation(m.n, m.shared);
      state.transfer = m.transfer;
    } else if (m.type == "simulate") {
      state.simulate(m.dt, m.substeps);
      if (state.transfer) {
        self.postMessage(state.p, [state.p.buffer]);
      } else {
        self.postMessage(state.p);
      }
    } else if (m.type == "restore") {
      state.setBuffer(m.buffer);
    }
  }, false);
}