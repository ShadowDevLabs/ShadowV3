"use strict";

/**
 *
 * @param {string} input
 * @param {string} template 
 * @returns {string}
 */
function search(input, template) {
  let url;

  try {
    url = new URL(input);
    if (url.hostname.includes(".")) {
      return url.toString();
    }
  } catch (err) {
    console.log(err)
  }

  try {
    url = new URL(`http://${input}`);
    if (url.hostname.includes(".")) {
      return url.toString();
    }
  } catch (err) {
    console.log(err)
  }

  return template.replace("%s", encodeURIComponent(input));
}