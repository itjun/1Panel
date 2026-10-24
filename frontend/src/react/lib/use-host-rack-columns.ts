import { useLayoutEffect, useState, type RefObject } from "react";
import { hostRackColumnCount } from "@/utils/hostRackLayout";

export function useHostRackColumns(root: RefObject<HTMLElement | null>) {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const styles = getComputedStyle(element);
    const minCardWidth = parseFloat(styles.getPropertyValue("--host-rack-card-min"));
    const gap = parseFloat(styles.getPropertyValue("--gap-card"));
    const measure = () => setColumns(hostRackColumnCount(element.clientWidth, minCardWidth, gap));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return columns;
}
