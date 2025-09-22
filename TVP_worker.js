onmessage = (e) => postMessage(e.data.map(URL.createObjectURL));
