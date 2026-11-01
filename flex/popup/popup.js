const api = typeof browser !== "undefined" ? browser : chrome;

document.getElementById("open").addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("finder.html") });
  window.close();
});

document.getElementById("open-watches").addEventListener("click", () => {
  api.tabs.create({ url: api.runtime.getURL("watches.html") });
  window.close();
});

api.runtime.sendMessage({ type: "GET_AUTH_STATUS" }).then((res) => {
  const status = document.getElementById("status");
  status.textContent = res && res.hasAuth
    ? "Innlogget på dele.no"
    : "Logg inn på app.dele.no først";
});
