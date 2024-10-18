import fs from "node:fs";
const users = {
    // 'john': "password" //Add user pass login
}

const port = 8080; //Change the port it binds to

//Edit broken-sites.json to prompt the user to redirect to a fixed version of a site (ex. now.gg --> nowgg.nl)
const brokenSites = async () => {
    const sites = JSON.parse(fs.readFileSync('./broken-sites.json', 'utf8'));
    sites.lastUpdate = Date.now();
    return sites;
};

export { users, port, brokenSites };