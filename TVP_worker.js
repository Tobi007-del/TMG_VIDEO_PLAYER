self.onmessage = function(event) {
    const files = event.data;

    const objectURLs = files.map(file => URL.createObjectURL(file));

    self.postMessage(objectURLs)
}