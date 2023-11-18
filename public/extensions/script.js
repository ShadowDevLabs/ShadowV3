if (localStorage.getItem("extensions") == null) {
    const testExt = {
      name: "Test",
      icon: "https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico",
      description: "Testing extension",
      code: "console.log('Hello World!')"
    }
    let testMainExt = {}
    testMainExt[123] = testExt
    console.log(testMainExt)
    localStorage.setItem("extensions", JSON.stringify(testMainExt))
  }
  
  function clear() {
    localStorage.clear()
  }
  
  function makeExtensionObj() {
    const extName = document.getElementsByName("extName")[0].value;
    const extIcon = document.getElementsByName("extIcon")[0].value;
    const extDesc = document.getElementsByName("extDesc")[0].value;
    const extCode = document.getElementsByName("extCode")[0].value;
    return extension = {
      name: extName,
      icon: extIcon,
      description: extDesc,
      code: extCode
    }
  }
  
  function generateId(length) {
    let result = '_';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }
  
  function save() {
    addExtension()
  }
  
  function addExtension() {
    let extensions = JSON.parse(localStorage.getItem("extensions"))
    const id = generateId(32);
    console.log(`Adding extension with ID ${id}`)
    extensions[id] = makeExtensionObj()
    console.log("New extensions Obj is:")
    console.log(extensions)
    localStorage.setItem("extensions", JSON.stringify(extensions))
  }