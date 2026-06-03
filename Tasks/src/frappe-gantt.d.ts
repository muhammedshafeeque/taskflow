declare module 'frappe-gantt' {
  interface GanttTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    dependencies?: string;
    custom_class?: string;
  }

  interface GanttOptions {
    view_mode?: string;
    view_modes?: string[];
    readonly?: boolean;
    container_height?: number | 'auto';
    on_click?: (task: GanttTask) => void;
    on_date_change?: (task: GanttTask, start: string, end: string) => void;
    [key: string]: unknown;
  }

  export default class Gantt {
    constructor(
      element: string | HTMLElement | SVGElement,
      tasks: GanttTask[],
      options?: GanttOptions
    );
    clear?: () => void;
  }
}
