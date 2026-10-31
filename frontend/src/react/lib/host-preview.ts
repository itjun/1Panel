export type HostPreview = { html: string; width: number; height: number; tool: string };

/** 只保留内存中的静态画面，不挂载第二份业务页，不触发主机请求。 */
export function captureHostPreview(root: HTMLElement, tool: string): HostPreview | null {
  const { width, height } = root.getBoundingClientRect();
  if (!width || !height) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  const canvases = root.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, index) => {
    const image = document.createElement("img");
    try {
      image.src = canvases[index].toDataURL();
      image.style.cssText = canvas.style.cssText;
      image.width = canvases[index].clientWidth;
      image.height = canvases[index].clientHeight;
      canvas.replaceWith(image);
    } catch {
      // 跨域画布无法读取时保留原画布空面，不影响主机切换。
    }
  });
  const inputs = root.querySelectorAll("input, textarea, select");
  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((input, index) => {
    if (input instanceof HTMLInputElement && input.type === "password") {
      input.removeAttribute("value");
      input.value = "";
    } else if (input instanceof HTMLTextAreaElement) {
      input.textContent = (inputs[index] as HTMLTextAreaElement).value;
    } else if (input instanceof HTMLInputElement) {
      input.setAttribute("value", (inputs[index] as HTMLInputElement).value);
    }
  });
  clone.querySelectorAll("script, iframe, object, embed, video, audio").forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith("on")) node.removeAttribute(attribute.name);
    }
  });
  const style = getComputedStyle(root);
  for (const property of [...style]) {
    if (property.startsWith("--")) clone.style.setProperty(property, style.getPropertyValue(property));
  }
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.fontFamily = style.fontFamily;
  clone.style.fontSize = style.fontSize;
  clone.style.color = style.color;
  const styles = [...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText); }
    catch { return []; }
  }).join("\n").replace(/<\/style/gi, "<\\/style");
  const html = document.documentElement.cloneNode(false) as HTMLElement;
  html.removeAttribute("style");
  html.innerHTML = "<head><meta charset=\"utf-8\"></head><body></body>";
  const css = document.createElement("style");
  css.textContent = `${styles}\nhtml,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}*{animation:none!important;transition:none!important;caret-color:transparent!important}`;
  html.querySelector("head")!.append(css);
  html.querySelector("body")!.append(clone);
  return { html: `<!doctype html>${html.outerHTML}`, width, height, tool };
}
