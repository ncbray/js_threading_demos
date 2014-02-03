self.addEventListener('message', function(evt) {
  self.postMessage("reply");
});