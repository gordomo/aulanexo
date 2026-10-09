for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}
for (const button of document.querySelectorAll("[data-print]"))
  button.addEventListener("click", () => window.print());
for (const button of document.querySelectorAll("[data-back]"))
  button.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  });
