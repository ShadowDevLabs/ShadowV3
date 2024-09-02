//I really have no clue where this came from, I updated it a bit for shadow:// urls, but uh thanks whoever made it

"use strict";

/**
 *
 * @param {string} input
 * @param {string} template
 * @returns {string}
 */
function search(input, template, backend) {
  let url;

  //Local shadow:// urls
  try {
    if (input.includes("shadow://")) {
      url = "/pages/" + input.replace("shadow://", "") + ".html";
      return url;
    }
  } catch (err) {}

  try {
    url = new URL(input);
    if (url.hostname.includes(".")) {
      return (
        `/${backend}/service/` + self.__uv$config.encodeUrl(url.toString())
      );
    }
  } catch (err) {}

  try {
    url = new URL(`https://${input}`);
    if (url.hostname.includes(".")) {
      return (
        `/${backend}/service/` + self.__uv$config.encodeUrl(url.toString())
      );
    }
  } catch (err) {}
  return (
    `/${backend}/service/` +
    self.__uv$config.encodeUrl(
      template.replace("%s", encodeURIComponent(input)),
    )
  );
}
