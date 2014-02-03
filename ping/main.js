var task = new Worker("worker.js");

var i = 0;
var start;
function ping() {
  if (i === 0) {
    start = performance.now();
  } else {
    if (i > 100000) return;
    if (i % 10000 == 0) {
      var current = performance.now();
      console.log((current - start) / i * 1000);
    }
  }
  i += 1;
  task.postMessage("ping");
}

task.addEventListener("message", function(evt) {
  ping();
});

task.postMessage("wakeup");
