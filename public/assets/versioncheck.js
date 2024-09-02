onload = async () => {
  if (
    (await fetch("/version")).headers["version"] !=
    localStorage.getItem("version")
  )
    caches.keys().then((list) => list.map((key) => caches.delete(key)));
  location.reload();
};
