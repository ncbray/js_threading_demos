var init = function(evt) {
  self.removeEventListener('message', init);
  self.addEventListener('message', followup);

  var sab = evt.data;

  console.log("Handling event.");
  var heap = new Uint8Array(sab);
  heap[0] = 1;

  sab.mutexLock(64);
  self.postMessage("yo");
  console.log("thread waiting");
  sab.condWait(128, 64);
  console.log("thread signaling");
  sab.condSignal(192);
  console.log("thread unlocking");
  sab.mutexUnlock(64);
  console.log("Done waiting.");

  for (var i = 0; i < 1000000000;i++) {
    if (heap[0] == 0) {
      console.log("Caught it! " + i);
      break;
    }
  }
  console.log("Done handling event.");
};

var followup = function(evt) {
  console.log("Followup.");
};

self.addEventListener('message', init);