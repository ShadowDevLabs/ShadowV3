self.__dynamic$config = {
  prefix: "/dyn/service/",
  encoding: "xor",
  mode: "production",
  logLevel: 0,
  bare: {
    version: 2,
    path: "/bare/",
  },
  tab: {
    title: "Service",
    icon: null,
    ua: null,
  },
  assets: {
    prefix: "/dynamic/",
    files: {
      handler: "dynamic.handler.js",
      client: "dynamic.client.js",
      worker: "dynamic.worker.js",
      config: "dynamic.config.js",
      inject: "/assets/extensions-loader.js",
    },
  },
  block: [],
};
