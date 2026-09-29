import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./main";

const SESSION_KEY = "webchat.sessionId";

const session = {
    id: "session-1",
    sessionId: "session-1",
    title: "New chat",
    state: {},
    historyClearedAt: null,
    createdAt: "2026-07-10T12:00:00+00:00",
    updatedAt: "2026-07-10T12:00:00+00:00",
};

const nextSession = {
    ...session,
    id: "session-2",
    sessionId: "session-2",
};

function jsonResponse(data: unknown) {
    return Promise.resolve({
        ok: true,
        json: async () => data,
    } as Response);
}

function errorResponse(status: number, detail: string) {
    return Promise.resolve({
        ok: false,
        status,
        json: async () => ({ detail }),
    } as Response);
}

function mockApi(messages: Array<Record<string, unknown>> = [], uploadError?: string) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url === "/api/sessions/session-1" && method === "GET") {
            return jsonResponse({ session, messages: [], documents: [] });
        }
        if (url === "/api/sessions" && method === "POST") {
            return jsonResponse({ session: nextSession });
        }
        if (url === "/api/sessions" && method === "GET") {
            return jsonResponse([session]);
        }
        if (url === "/api/sessions/session-2/messages" && method === "GET") {
            return jsonResponse({ sessionId: "session-2", messages: [] });
        }
        if (url === "/api/sessions/session-1/messages" && method === "GET") {
            return jsonResponse({ sessionId: "session-1", messages });
        }
        if (url === "/api/sessions/session-1/messages" && method === "POST") {
            return jsonResponse({
                session: {
                    ...session,
                    title: "confirmed user",
                    updatedAt: "2026-07-10T12:00:02+00:00",
                },
                userMessage: {
                    id: "server-user",
                    sessionId: "session-1",
                    role: "user",
                    text: "confirmed user",
                    createdAt: "2026-07-10T12:00:01+00:00",
                },
                assistantMessage: {
                    id: "server-assistant",
                    sessionId: "session-1",
                    role: "assistant",
                    text: "confirmed assistant\n\nSource: `notes.txt`",
                    metadata: {
                        tokenUsage: {
                            promptTokens: 8,
                            completionTokens: 4,
                            totalTokens: 12,
                        },
                    },
                    citations: [{ filename: "notes.txt", lineStart: 1, lineEnd: 3 }],
                    createdAt: "2026-07-10T12:00:02+00:00",
                },
                citations: [{ filename: "notes.txt", lineStart: 1, lineEnd: 3 }],
                actions: [],
            });
        }
        if (url === "/api/sessions/session-1/title" && method === "PATCH") {
            const body = JSON.parse(String(init?.body));
            return jsonResponse({
                ...session,
                title: body.title,
                updatedAt: "2026-07-10T12:02:00+00:00",
            });
        }
        if (url === "/api/sessions/session-1/history" && method === "DELETE") {
            messages.length = 0;
            return jsonResponse({
                sessionId: "session-1",
                clearedAt: "2026-07-10T12:01:00+00:00",
                messageCount: 2,
            });
        }
        if (url === "/api/sessions/session-1/documents" && method === "POST") {
            if (uploadError) {
                return errorResponse(400, uploadError);
            }
            return jsonResponse([
                {
                    id: "document-1",
                    sessionId: "session-1",
                    filename: "notes.txt",
                    contentType: "text/plain",
                    size: 12,
                    summary: "notes",
                    createdAt: "2026-07-10T12:01:00+00:00",
                },
            ]);
        }
        if (url === "/api/sessions/session-1" && method === "DELETE") {
            return jsonResponse({ sessionId: "session-1", deleted: true });
        }

        return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("App chat history", () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.localStorage.setItem(SESSION_KEY, "session-1");
        vi.restoreAllMocks();
    });

    it("hydrates chat messages from the server on load", async () => {
        const fetchMock = mockApi([
            {
                id: "message-1",
                sessionId: "session-1",
                role: "assistant",
                text: "hello from server",
                createdAt: "2026-07-10T12:00:00+00:00",
            },
        ]);

        render(<App />);

        expect(await screen.findByText("hello from server")).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/messages", undefined);
    });

    it("shows session actions in the chat header", async () => {
        mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete session" })).toBeInTheDocument();
    });

    it("collapses and expands the documents panel", async () => {
        mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        const documentsToggle = screen.getByRole("button", { name: /Documents/ });
        expect(documentsToggle).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("button", { name: "Upload documents" })).toBeInTheDocument();

        fireEvent.click(documentsToggle);
        expect(documentsToggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("button", { name: "Upload documents" })).not.toBeInTheDocument();

        fireEvent.click(documentsToggle);
        expect(documentsToggle).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("button", { name: "Upload documents" })).toBeInTheDocument();
    });

    it("collapses and expands the sidebar", async () => {
        mockApi([]);
        render(<App />);

        expect(await screen.findByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
        const appShell = document.querySelector(".app-shell");
        const collapseButton = screen.getByRole("button", { name: "Collapse sidebar" });

        expect(appShell).not.toHaveClass("sidebar-collapsed");
        expect(collapseButton).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(collapseButton);
        expect(appShell).toHaveClass("sidebar-collapsed");
        expect(collapseButton).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
        expect(appShell).not.toHaveClass("sidebar-collapsed");
        expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    });

    it("resizes the sidebar when dragging its desktop handle", async () => {
        mockApi([]);
        render(<App />);

        const collapseButton = await screen.findByRole("button", { name: "Collapse sidebar" });
        const appShell = document.querySelector(".app-shell");
        expect(appShell).not.toBeNull();
        expect(appShell).toHaveStyle("--sidebar-width: 280px");

        fireEvent.pointerDown(collapseButton, { clientX: 280, pointerId: 1 });
        fireEvent.pointerMove(collapseButton, { clientX: 380, pointerId: 1 });
        fireEvent.pointerUp(collapseButton, { clientX: 380, pointerId: 1 });
        fireEvent.click(collapseButton);

        expect(appShell).toHaveStyle("--sidebar-width: 380px");
        expect(appShell).not.toHaveClass("sidebar-collapsed");
    });

    it("asks for a session id and resumes that session when Resume is submitted", async () => {
        const fetchMock = mockApi([
            {
                id: "message-1",
                sessionId: "session-1",
                role: "assistant",
                text: "resumed from server",
                createdAt: "2026-07-10T12:00:00+00:00",
            },
        ]);
        render(<App />);
        expect(await screen.findByText("resumed from server")).toBeInTheDocument();
        expect(screen.getByText("Session")).toBeInTheDocument();
        expect(screen.getByText("session-1")).toBeInTheDocument();
        expect(screen.getByText("Session ID:")).toBeInTheDocument();

        fetchMock.mockClear();
        fireEvent.click(screen.getByRole("button", { name: /resume/i }));
        expect(screen.getByRole("dialog", { name: "Resume a saved chat" })).toBeInTheDocument();
        expect(screen.getByText("Resume a saved chat")).toBeInTheDocument();
        expect(screen.getByLabelText("Resume session ID")).toHaveValue("session-1");
        fireEvent.click(screen.getByRole("button", { name: "Resume chat" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1", undefined));
        expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/messages", undefined);
        expect(await screen.findByText("Session resumed.")).toBeInTheDocument();
    });

    it("replaces optimistic send state with the backend response", async () => {
        mockApi([]);
        render(<App />);

        const input = await screen.findByPlaceholderText("Message the assistant...");
        fireEvent.change(input, { target: { value: "local draft" } });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));

        expect(await screen.findByText("confirmed assistant")).toBeInTheDocument();
        expect(screen.getByText("confirmed user")).toBeInTheDocument();
        expect(screen.getByText("Session: 12 tokens (8 in / 4 out)")).toBeInTheDocument();
        expect(screen.getByText("Last response: 12 tokens (8 in / 4 out)")).toBeInTheDocument();
        expect(screen.getByLabelText("Chat subject")).toHaveValue("confirmed user");
        expect(screen.queryByText("local draft")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Citations")).toHaveTextContent("Source: notes.txt, lines 1-3");
        expect(screen.queryByText(/Source: `notes\.txt`/)).not.toBeInTheDocument();
    });

    it("submits the composer when Enter is pressed", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        const input = await screen.findByPlaceholderText("Message the assistant...");
        fireEvent.change(input, { target: { value: "send from enter" } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "send from enter" }),
        }));
        expect(await screen.findByText("confirmed assistant")).toBeInTheDocument();
    });

    it("saves an edited chat subject", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        const titleInput = await screen.findByLabelText("Chat subject");
        fireEvent.focus(titleInput);
        fireEvent.change(titleInput, { target: { value: "Planning notes" } });
        fireEvent.blur(titleInput);

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/title", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Planning notes" }),
            }),
        );
        expect(await screen.findByText("Subject saved.")).toBeInTheDocument();
        expect(screen.getByLabelText("Chat subject")).toHaveValue("Planning notes");
    });

    it("clears messages through the API and re-fetches messages", async () => {
        const messages = [
            {
                id: "message-1",
                sessionId: "session-1",
                role: "user",
                text: "old message",
                createdAt: "2026-07-10T12:00:00+00:00",
            },
        ];
        const fetchMock = mockApi(messages);
        render(<App />);

        expect(await screen.findByText("old message")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Clear messages" }));

        await waitFor(() => expect(screen.queryByText("old message")).not.toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/history", { method: "DELETE" });
        expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/messages", undefined);
    });

    it("uploads documents from the composer attach control", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        const fileInput = screen.getByLabelText("Document files");
        const file = new File(["hello upload"], "notes.txt", { type: "text/plain" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/documents", expect.any(Object)));
        const uploadCall = fetchMock.mock.calls.find(([url]) => url === "/api/sessions/session-1/documents");
        expect(uploadCall?.[1]?.method).toBe("POST");
        expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    });

    it("uploads documents from the sidebar dropzone", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        const dropzone = screen.getByRole("button", { name: "Upload documents" });
        const file = new File(["hello upload"], "notes.txt", { type: "text/plain" });
        fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/documents", expect.any(Object)));
        const uploadCall = fetchMock.mock.calls.find(([url]) => url === "/api/sessions/session-1/documents");
        expect(uploadCall?.[1]?.method).toBe("POST");
        expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    });

    it("opens the file picker from the sidebar dropzone", async () => {
        mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        const fileInput = screen.getByLabelText("Document files") as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);

        fireEvent.click(screen.getByRole("button", { name: "Upload documents" }));

        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("shows backend upload errors in a toast", async () => {
        const fetchMock = mockApi([], "No extractable text found in scan.pdf");
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        const fileInput = screen.getByLabelText("Document files");
        const file = new File(["not text"], "scan.pdf", { type: "application/pdf" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/documents", expect.any(Object)));
        expect(await screen.findByRole("status")).toHaveTextContent("No extractable text found in scan.pdf");
    });

    it("lets the backend validate files that the browser reports as empty", async () => {
        const fetchMock = mockApi([], "File is empty: empty.txt");
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        fetchMock.mockClear();
        const fileInput = screen.getByLabelText("Document files");
        const file = new File([], "empty.txt", { type: "text/plain" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/documents", expect.any(Object)));
        expect(await screen.findByRole("status")).toHaveTextContent("File is empty: empty.txt");
    });

    it("uploads readable text files even when the browser reports zero bytes", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        fetchMock.mockClear();
        const fileInput = screen.getByLabelText("Document files");
        const file = new File(["some text"], "text.txt", { type: "text/plain" });
        Object.defineProperty(file, "size", { value: 0 });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/documents", expect.any(Object)));
        expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    });

    it("deletes the current session without creating a replacement", async () => {
        const fetchMock = mockApi([]);
        render(<App />);

        expect(await screen.findByText("Session ID:")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Delete session" }));

        expect(screen.getByRole("dialog", { name: "Delete a saved chat" })).toBeInTheDocument();
        expect(screen.getByText("Delete a saved chat")).toBeInTheDocument();
        expect(screen.getByLabelText("Delete session ID")).toHaveValue("session-1");
        expect(screen.getByText("Delete session session-1?")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1", { method: "DELETE" }));
        expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", { method: "POST" });
        expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
        expect(await screen.findByRole("status")).toHaveTextContent("Session deleted.");
    });
});