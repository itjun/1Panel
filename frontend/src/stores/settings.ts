import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type ThemeKey = "light" | "dark" | "auto";

export const useSettingsStore = defineStore("settings", () => {
  const theme = ref<ThemeKey>(
    (localStorage.getItem("ipannel.theme") as ThemeKey) || "light"
  );

  function applyTheme(t: ThemeKey) {
    let actual: "light" | "dark" = "light";
    if (t === "auto") {
      actual = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } else {
      actual = t;
    }
    document.documentElement.className = actual;
    document.documentElement.setAttribute("data-theme", actual);
  }

  function setTheme(t: ThemeKey) {
    theme.value = t;
    localStorage.setItem("ipannel.theme", t);
    applyTheme(t);
  }

  function cycleTheme() {
    const order: ThemeKey[] = ["light", "dark", "auto"];
    const i = order.indexOf(theme.value);
    setTheme(order[(i + 1) % order.length]);
  }

  applyTheme(theme.value);

  if (typeof window !== "undefined") {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (theme.value === "auto") applyTheme("auto");
      });
  }

  watch(theme, (t) => applyTheme(t));

  return { theme, setTheme, cycleTheme };
});
