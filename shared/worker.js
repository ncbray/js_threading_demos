self.addEventListener('message', function(evt) {
  var buffer = evt.data;
  console.log("worker shared? " + buffer.shared);
  var mem = new Uint8Array(buffer);
  console.log("worker before " + mem[0]);
  mem[0] = 1;
  console.log("worker after " + mem[0]);
});