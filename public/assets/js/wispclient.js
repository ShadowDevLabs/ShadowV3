// From https://github.com/MercuryWorkshop/wisp-client-js 
var _wisp_connections = {};
export var WispWebSocket = class extends EventTarget {
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.binaryType = "blob";
    this.stream = null;
    this.event_listeners = {};
    this.connection = null;
    this.onopen = () => {
    };
    this.onerror = () => {
    };
    this.onmessage = () => {
    };
    this.onclose = () => {
    };
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;
    let url_split = this.url.split("/");
    let wsproxy_path = url_split.pop().split(":");
    this.host = wsproxy_path[0];
    this.port = parseInt(wsproxy_path[1]);
    this.real_url = url_split.join("/") + "/";
    this.init_connection();
  }
  on_conn_close() {
    if (_wisp_connections[this.real_url]) {
      this.dispatchEvent(new Event("error"));
    }
    delete _wisp_connections[this.real_url];
  }
  init_connection() {
    this.connection = _wisp_connections[this.real_url];
    if (!this.connection) {
      this.connection = new WispConnection(this.real_url);
      this.connection.addEventListener("open", () => {
        this.init_stream();
      });
      this.connection.addEventListener("close", () => {
        this.on_conn_close();
      });
      this.connection.addEventListener("error", (event) => {
        this.on_conn_close();
      });
      _wisp_connections[this.real_url] = this.connection;
    } else if (!this.connection.connected) {
      this.connection.addEventListener("open", () => {
        this.init_stream();
      });
    } else {
      this.connection = _wisp_connections[this.real_url];
      this.init_stream();
    }
  }
  init_stream() {
    this.stream = this.connection.create_stream(this.host, this.port);
    this.stream.addEventListener("message", (event) => {
      let data;
      if (this.binaryType == "blob") {
        data = new Blob(event.data);
      } else if (this.binaryType == "arraybuffer") {
        data = event.data.buffer;
      } else {
        throw "invalid binaryType string";
      }
      let msg_event = new MessageEvent("message", { data });
      this.onmessage(msg_event);
      this.dispatchEvent(msg_event);
    });
    this.stream.addEventListener("close", (event) => {
      let close_event = new (globalThis.CloseEvent || Event)("close", { code: event.code });
      this.onclose(close_event);
      this.dispatchEvent(close_event);
    });
    let open_event = new Event("open");
    this.onopen(open_event);
    this.dispatchEvent(open_event);
  }
  send(data) {
    let data_array;
    if (typeof data === "string") {
      data_array = new TextEncoder().encode(data);
    } else if (data instanceof Blob) {
      data.arrayBuffer().then((array_buffer) => {
        data_array = new Uint8Array(array_buffer);
        this.send(data_array);
      });
      return;
    } else if (data instanceof ArrayBuffer) {
      if (ArrayBuffer.isView(data) && data instanceof DataView) {
        data_array = new Uint8Array(data.buffer);
      } else {
        data_array = new Uint8Array(data);
      }
    } else if (ArrayBuffer.isView(data)) {
      data_array = Uint8Array.from(data);
    } else {
      throw "invalid data type";
    }
    if (!this.stream) {
      throw "websocket is not ready";
    }
    this.stream.send(data_array);
  }
  close() {
    this.stream.close(2);
  }
  get bufferedAmount() {
    let total = 0;
    for (let msg of this.stream.send_buffer) {
      total += msg.length;
    }
    return total;
  }
  get extensions() {
    return "";
  }
  get protocol() {
    return "binary";
  }
  get readyState() {
    if (this.connection && !this.connection.connected && !this.connection.connecting) {
      return this.CLOSED;
    }
    if (!this.connection || !this.connection.connected) {
      return this.CONNECTING;
    }
    if (this.stream.open) {
      return this.OPEN;
    }
    return this.CLOSED;
  }
};

// src/wisp.mjs
var RealWS;
if (typeof process !== "undefined") {
  let ws = await import("ws");
  RealWS = ws.WebSocket;
} else {
  RealWS = globalThis.WebSocket;
}
var packet_types = {
  CONNECT: 1,
  DATA: 2,
  CONTINUE: 3,
  CLOSE: 4
};
var packet_names = [void 0, "CONNECT", "DATA", "CONTINUE", "CLOSE"];
function uint_from_array(array) {
  if (array.length == 4)
    return new Uint32Array(array.buffer)[0];
  else if (array.length == 2)
    return new Uint16Array(array.buffer)[0];
  else if (array.length == 1)
    return array[0];
  else
    throw "invalid array length";
}
function array_from_uint(int, size) {
  let buffer = new ArrayBuffer(size);
  let view = new DataView(buffer);
  if (size == 1)
    view.setUint8(0, int, true);
  else if (size == 2)
    view.setUint16(0, int, true);
  else if (size == 4)
    view.setUint32(0, int, true);
  else
    throw "invalid array length";
  return new Uint8Array(buffer);
}
function concat_uint8array() {
  let total_length = 0;
  for (let array of arguments) {
    total_length += array.length;
  }
  let new_array = new Uint8Array(total_length);
  let index = 0;
  for (let array of arguments) {
    new_array.set(array, index);
    index += array.length;
  }
  return new_array;
}
function create_packet(packet_type, stream_id, payload) {
  let stream_id_array = array_from_uint(stream_id, 4);
  let packet_type_array = array_from_uint(packet_type, 1);
  let packet = concat_uint8array(packet_type_array, stream_id_array, payload);
  return packet;
}
var WispStream = class extends EventTarget {
  constructor(hostname, port, websocket, buffer_size, stream_id, connection, stream_type) {
    super();
    this.hostname = hostname;
    this.port = port;
    this.ws = websocket;
    this.buffer_size = buffer_size;
    this.stream_id = stream_id;
    this.connection = connection;
    this.stream_type = stream_type;
    this.send_buffer = [];
    this.open = true;
    this.onopen = () => {
    };
    this.onclose = () => {
    };
    this.onerror = () => {
    };
    this.onmessage = () => {
    };
  }
  send(data) {
    if (this.buffer_size > 0 || !this.open || this.stream_type === 2) {
      let packet = create_packet(2, this.stream_id, data);
      this.ws.send(packet);
      this.buffer_size--;
    } else {
      this.send_buffer.push(data);
    }
  }
  //handle receiving a CONTINUE packet
  continue_received(buffer_size) {
    this.buffer_size = buffer_size;
    while (this.buffer_size > 0 && this.send_buffer.length > 0) {
      this.send(this.send_buffer.shift());
    }
  }
  //construct and send a CLOSE packet
  close(reason = 1) {
    if (!this.open)
      return;
    let payload = array_from_uint(reason, 1);
    let packet = create_packet(4, this.stream_id, payload);
    this.ws.send(packet);
    this.open = false;
    delete this.connection.active_streams[this.stream_id];
  }
};
var WispConnection = class extends EventTarget {
  constructor(wisp_url) {
    super();
    this.wisp_url = wisp_url;
    this.max_buffer_size = null;
    this.active_streams = {};
    this.connected = false;
    this.connecting = false;
    this.next_stream_id = 1;
    if (!this.wisp_url.endsWith("/")) {
      throw "wisp endpoints must end with a trailing forward slash";
    }
    this.connect_ws();
  }
  connect_ws() {
    this.ws = new RealWS(this.wisp_url);
    this.ws.binaryType = "arraybuffer";
    this.connecting = true;
    this.ws.onerror = () => {
      this.on_ws_close();
      this.dispatchEvent(new Event("error"));
    };
    this.ws.onclose = () => {
      this.on_ws_close();
      let event = new (globalThis.CloseEvent || Event)("close");
      this.dispatchEvent(event);
    };
    this.ws.onmessage = (event) => {
      this.on_ws_msg(event);
      if (this.connecting) {
        this.connected = true;
        this.connecting = false;
        this.dispatchEvent(new Event("open"));
      }
    };
  }
  close_stream(stream, reason) {
    let close_event = new (globalThis.CloseEvent || Event)("close", { code: reason });
    stream.open = false;
    stream.dispatchEvent(close_event);
    delete this.active_streams[stream.stream_id];
  }
  on_ws_close() {
    this.connected = false;
    this.connecting = false;
    for (let stream_id of Object.keys(this.active_streams)) {
      this.close_stream(this.active_streams[stream_id], 3);
    }
  }
  create_stream(hostname, port, type = "tcp") {
    let stream_type = type === "udp" ? 2 : 1;
    let stream_id = this.next_stream_id;
    this.next_stream_id++;
    let stream = new WispStream(hostname, port, this.ws, this.max_buffer_size, stream_id, this, stream_type);
    stream.open = this.connected;
    let type_array = array_from_uint(stream_type, 1);
    let port_array = array_from_uint(port, 2);
    let host_array = new TextEncoder().encode(hostname);
    let payload = concat_uint8array(type_array, port_array, host_array);
    let packet = create_packet(1, stream_id, payload);
    this.active_streams[stream_id] = stream;
    this.ws.send(packet);
    return stream;
  }
  on_ws_msg(event) {
    let packet = new Uint8Array(event.data);
    if (packet.length < 5) {
      console.warn(`wisp client warning: received a packet which is too short`);
      return;
    }
    let packet_type = packet[0];
    let stream_id = uint_from_array(packet.slice(1, 5));
    let payload = packet.slice(5);
    let stream = this.active_streams[stream_id];
    if (typeof stream === "undefined" && stream_id !== 0) {
      console.warn(`wisp client warning: received a ${packet_names[packet_type]} packet for a stream which doesn't exist`);
      return;
    }
    if (packet_type === packet_types.DATA) {
      let msg_event = new MessageEvent("message", { data: payload });
      stream.dispatchEvent(msg_event);
    } else if (packet_type === packet_types.CONTINUE && stream_id == 0) {
      this.max_buffer_size = uint_from_array(payload);
    } else if (packet_type === packet_types.CONTINUE) {
      stream.continue_received(uint_from_array(payload));
    } else if (packet_type === packet_types.CLOSE) {
      this.close_stream(stream, payload[0]);
    } else {
      console.warn(`wisp client warning: receive an invalid packet of type ${packet_type}`);
    }
  }
};