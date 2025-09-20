"use strict";

function search(input, template, backend) {
  let url;

  // Local shadow:// urls
  try {
    if (input.includes("shadow://")) {
      url = "/pages/" + input.replace("shadow://", "") + ".html";
      return url;
    }
  } catch (err) {}

  try {
    url = new URL(input);
    if (url.hostname.includes(".")) {
      if (backend === "uv") return "/" + backend + "/service/" + self.__uv$config.encodeUrl(url.toString());
      if (backend === "sj") return scramjet.encodeUrl(url.toString());
    }
  } catch (err) {}

  try {
    url = new URL(`https://${input}`);
    if (url.hostname.includes(".")) {
      if (backend === "uv") return "/" + backend + "/service/" + self.__uv$config.encodeUrl(url.toString());
      if (backend === "sj") return scramjet.encodeUrl(url.toString());
    }
  } catch (err) {}

  // fallback → search template
  if (backend === "uv") return "/" + backend + "/service/" + self.__uv$config.encodeUrl(template.replace("%s", encodeURIComponent(input)));
  if (backend === "sj") return scramjet.encodeUrl(template.replace("%s", encodeURIComponent(input)));

  return template.replace("%s", encodeURIComponent(input));
}
