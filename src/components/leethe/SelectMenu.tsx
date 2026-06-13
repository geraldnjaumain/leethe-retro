import { useState, useRef, useEffect } from "react";

type Option = {
  value: string | number;
  label: string | number;
};

type SelectMenuProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Option[];
  direction?: "up" | "down";
};

export function SelectMenu({ label, value, onChange, options, direction = "up" }: SelectMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-flex flex-col stream-menu-container">
      <button
        type="button"
        className="stream-menu w-full focus-visible:ring-2 focus-visible:ring-[oklch(0.62_0.1_245/0.55)] outline-none text-left flex items-center justify-between gap-3"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="flex gap-1.5 items-center truncate">
          {label && <span className="text-[10px] text-[oklch(0.7_0.01_250)]">{label}</span>}
          <span className="text-[11px] text-foreground truncate max-w-[12rem]">
            {selectedOption?.label ?? value}
          </span>
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 right-0 min-w-full w-max max-w-[16rem] overflow-hidden rounded-md border border-[oklch(0.2_0.005_250)] bg-[oklch(0.18_0.008_250)] shadow-lg animate-fade-in shadow-[0_10px_30px_rgba(0,0,0,0.5)] ${direction === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          <ul className="max-h-64 overflow-auto py-1 overscroll-contain">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-[oklch(0.28_0.008_250)] transition-colors truncate ${
                    String(option.value) === String(value)
                      ? "bg-[oklch(0.25_0.008_250)] text-white font-medium"
                      : "text-foreground/90"
                  }`}
                  onClick={() => {
                    onChange(String(option.value));
                    setIsOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
