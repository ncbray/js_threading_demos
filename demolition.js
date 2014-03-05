"use strict";

window.demolition = {};

(function(exports) {

  // sRGB
  var linearToGamma = function(l) {
    if (l > 0.0031308) {
      return 1.055 * Math.pow(l, 0.41666666666667) - 0.055;
    } else {
      return 12.92 * l;
    }
  };

  var clamp = function(v, min, max) {
    if (v > min) {
      if (v < max) {
        return v;
      } else {
        return max;
      }
    } else {
      return min;
    }
  };

  // Build a lookup table.
  var l2g = new Uint8Array(4096);
  for (var i = 0; i < 4096; i++) {
    l2g[i] = clamp(Math.round(linearToGamma(i / 4095)*255), 0, 255)
  }

  var linearToByte = function(l) {
    var index = Math.round(l * 4095);
    if (index > 4095) {
      return 255;
    } else if (index < 0) {
      return 0;
    } else {
      return l2g[index];
    }
    //return clamp(Math.round(Math.sqrt(l)*255), 0, 255);
    //return clamp(Math.round(linearToGamma(l)*255), 0, 255);
  };

  var linearStyle = function(r, g, b) {
    return "rgb(" + linearToByte(r) + ", " + linearToByte(g) + ", " + linearToByte(b) + ")";
  };

  var byteColorToInt = function(r, g, b) {
    return r | g << 8 | b << 16 | 255 << 24;
  };

  var blend = function(x, y, amt) {
    return x * (1 - amt) + y * amt;
  };

  var smoothstep = function(e0, e1, amt) {
    amt = clamp((amt - e0) / (e1 - e0), 0, 1);
    return amt * amt * (3 - 2 * amt);
  };

  exports.linearToGamma = linearToGamma;
  exports.linearToByte = linearToByte;
  exports.linearStyle = linearStyle;
  exports.byteColorToInt = byteColorToInt;
  exports.clamp = clamp;
  exports.blend = blend;
  exports.smoothstep = smoothstep;

  var makePump = function(runner) {
    return function() {
      runner.doFrame();
    }
  };

  var DemoRunner = function(config) {
    this.pump = makePump(this);
    this.maxDelta(0.25).autoPump(true);
    this.pendingFrame = 0;
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
    if (this.pendingFrame) {
      cancelRequestAnimFrame(this.pendingFrame);
    }
    this.pendingFrame = requestAnimFrame(this.pump);
  };

  DemoRunner.prototype.doFrame = function() {
    this.pendingFrame = 0;
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

  var Settings = function(vars) {
    this.vars = vars;
  };

  Settings.prototype.string = function(name, def) {
    if (name in this.vars) {
      return this.vars[name];
    }
    return def;
  };

  Settings.prototype.number = function(name, def) {
    if (name in this.vars) {
      var coerce = +this.vars[name];
      if (!isNaN(coerce)) {
        return coerce;
      }
    }
    return def;
  };

  Settings.prototype.bool = function(name, def) {
    if (name in this.vars) {
      var val = this.vars[name].toLowerCase();
      if (val == "true") {
        return true;
      } else if (val == "false") {
        return false;
      }
      var coerce = +this.vars[name];
      if (!isNaN(coerce)) {
        return !!coerce;
      }
    }
    return def;
  };

  var SettingsSchema = function() {
    this.vars = [];
  };

  SettingsSchema.prototype.string = function(name, def) {
    this.vars.push({
      name: name,
      def: def,
      decode: function(s) {
        return s.string(this.name, this.def);
      },
    });
    return this;
  };

  SettingsSchema.prototype.number = function(name, def) {
    this.vars.push({
      name: name,
      def: def,
      decode: function(s) {
        return s.number(this.name, this.def);
      },
    });
    return this;
  };

  SettingsSchema.prototype.bool = function(name, def) {
    this.vars.push({
      name: name,
      def: def,
      decode: function(s) {
        return s.bool(this.name, this.def);
      },
    });
    return this;
  };

  SettingsSchema.prototype.decode = function(s) {
    var out = {};
    for (var i in this.vars) {
      out[this.vars[i].name] = this.vars[i].decode(s);
    }
    return out;
  };

  SettingsSchema.prototype.encode = function(s) {
    var out = [];
    for (var i in this.vars) {
      var name = this.vars[i].name;
      if (name in s) {
        var def = this.vars[i].def;
        var val = s[name];
        if (val != def) {
          out.push(encodeURIComponent(name) + "=" + encodeURIComponent(val));
        }
      }
    }
    return out.join("&");
  };

  exports.SettingsSchema = SettingsSchema;

  exports.parseQuery = function() {
    var vars = {};
    var split = window.location.search.substring(1).split('&');
    for (var i = 0; i < split.length; i++) {
      var pair = split[i].split('=');
      if (pair.length == 2) {
        vars[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
      }
    }
    return new Settings(vars);
  };

})(window.demolition);
