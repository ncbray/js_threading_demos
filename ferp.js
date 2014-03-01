"use strict";
(function(exports) {
  var getTime = function() { return Date.now(); };
  if (typeof window.performance !== "undefined" && typeof window.performance.now !== "undefined") {
    getTime = function() { return performance.now(); };
  }

  var PerfTracker = function(label, w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this.domElement = c;
    this.ctx = c.getContext('2d');
    this.samples = [];
    this.padding = 2;
    this.maxSamples = w - 2 * this.padding;

    this.label = label;
    this.current = 0;
    this.accum = 0;

    this.draw();
  };

  PerfTracker.prototype.begin = function() {
    this.start = getTime();
  };

  PerfTracker.prototype.end = function() {
    var dt = getTime()-this.start;
    if (dt < 0) {
      dt = 0;
    }
    this.addSample(dt);
  };

  PerfTracker.prototype.beginSlice = function() {
    this.start = getTime();
  };

  PerfTracker.prototype.endSlice = function() {
    var dt = getTime()-this.start;
    if (dt < 0) {
      dt = 0;
    }
    this.accum += dt;
  };

  PerfTracker.prototype.commit = function() {
    this.addSample(this.accum);
    this.accum = 0;
  };

  PerfTracker.prototype.addSample = function(dt) {
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    this.samples.push(dt);
    var sum = 0;
    for (var i = 0; i < this.samples.length; i++) {
      sum += this.samples[i];
    }
    this.current = sum / this.samples.length;
    this.draw();
  };

  PerfTracker.prototype.draw = function() {
    var ctx = this.ctx;
    var w = this.domElement.width;
    var h = this.domElement.height;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "gray";
    ctx.strokeRect(1, 1, w-2, h-2);

    ctx.fillStyle = "green";

    var shift = this.padding + this.maxSamples - this.samples.length + 1;

    ctx.beginPath();
    ctx.moveTo(shift, h - this.padding);

    var scale = h - 2 * this.padding;

    for (var i = 0; i < this.samples.length; i++) {
      var amt = this.samples[i] / (2 * this.current);

      ctx.lineTo(i + shift, h - this.padding - amt * scale);
    }
    ctx.lineTo(w - this.padding, h - this.padding);
    ctx.closePath;
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = "12px monospace";
    ctx.fillText(this.current.toPrecision(3) + " ms", this.padding, 10 + this.padding);

    ctx.fillText(this.label, w - this.padding - ctx.measureText(this.label).width - 2, 10 + this.padding);
  };

  exports.PerfTracker = PerfTracker;
})(this);