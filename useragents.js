import * as cheerio from "cheerio";
import http from "http";
const port = 8000;

async function getRecentUA() {
  let text = await fetch("https://useragents.me/");
  text = await text.text();
  const $ = cheerio.load(text);
  return $(
    "#most-common-desktop-useragents-json-csv > div:eq(0) > textarea",
  ).val();
}

const requestListener = async function (req, res) {
  res.end(await getRecentUA());
};

const server = http.createServer(requestListener);
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
