import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
    cleanup();
});

const localStorageStub = (() => {
    let values: Record<string, string> = {};
    return {
        clear: () => {
            values = {};
        },
        getItem: (key: string) => values[key] ?? null,
        removeItem: (key: string) => {
            delete values[key];
        },
        setItem: (key: string, value: string) => {
            values[key] = value;
        },
    };
})();

Object.defineProperty(window, "localStorage", {
    value: localStorageStub,
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    value: () => undefined,
});