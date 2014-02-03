"use strict";

window.demolition = {};

(function(exports) {

  // sRGB
  exports.linearToGamma = function(l) {
    if (l > 0.0031308) {
      return 1.055 * Math.pow(l, 1/2.4) - 0.055;
    } else {
      return 12.92 * l;
    }
  };


  exports.clamp = function(v, min, max) {
    return Math.max(Math.min(v, max), min)
  }

  var makePump = function(runner) {
    return function() {
      runner.doFrame();
    }
  };

  var DemoRunner = function(config) {
    this.pump = makePump(this);
    this.maxDelta(0.25).autoPump(true);
  };

  DemoRunner.prototype.autoPump = function(ok) {
    this.autoPump_ = ok;
    return this;
  };

  DemoRunner.prototype.maxDelta = function(amt) {
    this.maxDelta_ = amt;
    return this;
  };

  DemoRunner.prototype.onFrame = function(callback) {
    this.frameCallback = callback;
    return this;
  }

  DemoRunner.prototype.scheduleFrame = function() {
    requestAnimFrame(this.pump);
  };

  DemoRunner.prototype.doFrame = function() {
    if (this.autoPump_) {
      this.scheduleFrame();
    }

    // Calculate the elapsed time.
    var current = performance.now();
    if (this.last == undefined) {
      this.last = current;
    }
    var dt = (current - this.last) / 1000;
    this.last = current;

    dt = demolition.clamp(dt, 0, this.maxDelta_);

    this.frameCallback(dt);
  };

  exports.DemoRunner = DemoRunner;

})(window.demolition);
