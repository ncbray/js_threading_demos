var task = new Worker("worker.js");
task.addEventListener("message", function(evt) {
  console.log("Worker said: ", evt.data);
});

var buffer = new ArrayBuffer(16, true);
console.log("main shared? " + buffer.shared)

task.postMessage(buffer, [buffer]);

var mem = new Uint8Array(buffer);

console.log("main initial " + mem[0]);

setTimeout(function() {
  console.log("main delayed " + mem[0]);
}, 100);