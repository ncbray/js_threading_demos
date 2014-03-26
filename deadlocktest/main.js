var task = new Worker("worker.js");

var sab = new ArrayBuffer(1024, true);
sab.mutexInit(64);
sab.condInit(128);
sab.condInit(192);
var heap = new Uint8Array(sab);

task.addEventListener("message", function(evt) {
  // At this point we know the worker is up and running.
  console.log("Got reply");
  heap[0] = 0;
  sab.mutexLock(64);
  console.log("main signaling");
  sab.condSignal(128);
  console.log("main waiting");
  sab.condWait(192, 64);
  console.log("main woken up");
  sab.mutexUnlock(64);
  console.log("Done reply.");
});

task.postMessage(sab, [sab]);
/*
for (var i = 0; i < 1000000000;i++) {
  if (heap[0] != 0) {
    console.log("Caught it!");
  }
}
*/
console.log("Done with turn.");