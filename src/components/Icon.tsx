const paths = {
  wave: "M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4",
  edit: "M12 20H4v-8M16 3l5 5-11 11-5 1 1-5Z M14 5l5 5",
  voices: "M9 18V5l12-2v13M9 14H5a3 3 0 1 0 3 3M21 12h-4a3 3 0 1 0 3 3",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  plus: "M12 5v14M5 12h14",
  more: "M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  close: "M6 6l12 12M18 6 6 18",
  play: "m9 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  check: "m5 12 4 4L19 6",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4",
  download: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
  file: "M14 2H5v20h14V7Z M14 2v5h5M8 12h8M8 16h6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  back: "m14 5-7 7 7 7",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  folder: "M3 6h7l2 2h9v12H3Z",
  copy: "M8 8h13v13H8ZM16 8V3H3v13h5",
  shield: "m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z m-4 10 3 3 5-5",
  refresh: "M20 11a8 8 0 1 0-2 6M20 4v7h-7",
  external: "M14 3h7v7M10 14 21 3M10 3H3v18h18v-7",
} satisfies Record<string, string>;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
