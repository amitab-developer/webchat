import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import AddCommentIcon from "@mui/icons-material/AddComment";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import DriveFolderUploadIcon from "@mui/icons-material/DriveFolderUpload";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import SmsIcon from "@mui/icons-material/Sms";
import "./styles.css";

type Role = "user" | "assistant" | "system";

type ChatSession = {
  id: string;
  sessionId?: string;
  title: string;
  state?: Record<string, unknown>;
  historyClearedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  sessionId: string;
  role: Role;
  text: string;
  contents?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  citations?: Array<SourceCitation | string>;
};

type SourceCitation = {
  filename: string;
  lineStart?: number | null;
  lineEnd?: number | null;
};

type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
};

type DocumentRecord = {
  id: string;
  sessionId: string;
  filename: string;
  contentType?: string;
  size: number;
  summary: string;
  createdAt: string;
};

type SessionState = {
  session: ChatSession;
  messages: ChatMessage[];
  documents: DocumentRecord[];
};

type MessagesResponse = {
  sessionId: string;
  messages: ChatMessage[];
};

type SendMessageResponse = {
  session?: ChatSession;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  citations?: Array<SourceCitation | string>;
  actions?: Record<string, unknown>[];
};

type ToastMessage = {
  id: number;
  text: string;
  tone: "success" | "error";
  createdAt: number;
};

const SESSION_KEY = "webchat.sessionId";
const TOAST_DURATION_MS = 3200;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 440;
const UPLOAD_ACCEPT = ".txt,.md,.csv,.json,.pdf,.docx";
const SUPPORTED_UPLOAD_EXTENSIONS = new Set(UPLOAD_ACCEPT.split(","));
const TEXT_UPLOAD_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);
const STARTER_PROMPTS = [
  "Summarize an uploaded document",
  "Draft a concise response",
  "Compare the key points",
  "Help me think through an idea",
];

const theme = createTheme({
  palette: {
    primary: { main: "#10a37f" },
    error: { main: "#b4232f" },
    background: { default: "#ffffff", paper: "#ffffff" },
    text: { primary: "#0d0d0d", secondary: "#6b7280" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: "none", fontWeight: 650 } },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
  },
});

export function App() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [composer, setComposer] = useState("");
  const [titleDraft, setTitleDraft] = useState("Chat");
  const [resumeSessionId, setResumeSessionId] = useState("");
  const [deleteSessionId, setDeleteSessionId] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [isResumePanelOpen, setIsResumePanelOpen] = useState(false);
  const [isDeletePanelOpen, setIsDeletePanelOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isSessionSectionOpen, setIsSessionSectionOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [toastCountdown, setToastCountdown] = useState(100);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const skipTitleSaveRef = useRef(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);

  const canSend = composer.trim().length > 0 && !isSending;
  const draftTokenCount = useMemo(() => estimateTokens(composer), [composer]);
  const sessionTokenUsage = useMemo(() => summarizeTokenUsage(messages), [messages]);
  const lastTokenUsage = useMemo(() => latestTokenUsage(messages), [messages]);
  const documentCountLabel = useMemo(() => {
    if (documents.length === 0) return "No documents";
    if (documents.length === 1) return "1 document";
    return `${documents.length} documents`;
  }, [documents.length]);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isSending]);

  useEffect(() => {
    if (isResumePanelOpen) {
      resumeInputRef.current?.focus();
    }
  }, [isResumePanelOpen]);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(session?.title || "Chat");
    }
  }, [isEditingTitle, session?.id, session?.title]);

  useEffect(() => {
    if (!toast) {
      setToastCountdown(100);
      return;
    }
    setToastCountdown(100);
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - toast.createdAt;
      setToastCountdown(Math.max(0, 100 - (elapsed / TOAST_DURATION_MS) * 100));
    }, 100);
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [toast]);

  async function initialize() {
    setIsLoading(true);
    setStatus("");
    try {
      const existingSessionId = window.localStorage.getItem(SESSION_KEY);
      if (existingSessionId) {
        await loadSessionState(existingSessionId);
      } else {
        const availableSessions = await listSessions().catch(() => []);
        setSessions(availableSessions);
        setSession(null);
        setMessages([]);
        setDocuments([]);
      }
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setMessages([]);
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSessionState(sessionId: string, knownSession?: ChatSession) {
    const [state, messageState, availableSessions] = await Promise.all([
      knownSession ? Promise.resolve<SessionState>({ session: knownSession, messages: [], documents: [] }) : getSession(sessionId),
      listMessages(sessionId),
      listSessions().catch(() => []),
    ]);
    setSessions(availableSessions);
    applySessionState({ ...state, messages: messageState.messages });
  }

  function applySessionState(state: SessionState) {
    setSession(state.session);
    setMessages(state.messages);
    setDocuments(state.documents);
  }

  function replaceSessionInList(updatedSession: ChatSession) {
    setSessions((current) => {
      const next = current.some((item) => item.id === updatedSession.id)
        ? current.map((item) => item.id === updatedSession.id ? updatedSession : item)
        : [updatedSession, ...current];
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async function handleNewChat() {
    setIsLoading(true);
    try {
      window.localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setMessages([]);
      setDocuments([]);
      setComposer("");
      setStatus("");
      setIsMenuOpen(false);
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenResumeSession() {
    setResumeSessionId(window.localStorage.getItem(SESSION_KEY) || "");
    setIsResumePanelOpen(true);
    setIsDeletePanelOpen(false);
    setStatus("");
  }

  function handleCloseResumeSession() {
    setIsResumePanelOpen(false);
    setResumeSessionId("");
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === session?.id || isLoading) return;
    setIsLoading(true);
    setStatus("");
    try {
      await loadSessionState(sessionId);
      window.localStorage.setItem(SESSION_KEY, sessionId);
      setComposer("");
      setIsMenuOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open saved session.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenDeleteSession(sessionId?: string) {
    setDeleteSessionId(sessionId || session?.id || window.localStorage.getItem(SESSION_KEY) || "");
    setIsDeleteConfirming(true);
    setIsDeletePanelOpen(true);
    setIsResumePanelOpen(false);
    setStatus("");
  }

  function handleCloseDeleteSession() {
    setIsDeletePanelOpen(false);
    setDeleteSessionId("");
    setIsDeleteConfirming(false);
  }

  async function handleCopySessionId() {
    if (!session) return;
    await navigator.clipboard?.writeText(session.id);
    setStatus("Session ID copied.");
  }

  async function handleResumeSession(event: FormEvent) {
    event.preventDefault();
    const requestedSessionId = resumeSessionId.trim();
    if (!requestedSessionId) {
      setStatus("Enter a session ID to resume.");
      return;
    }
    setIsLoading(true);
    setStatus("");
    try {
      await loadSessionState(requestedSessionId);
      window.localStorage.setItem(SESSION_KEY, requestedSessionId);
      setComposer("");
      setIsResumePanelOpen(false);
      setIsMenuOpen(false);
      setStatus("Session resumed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not resume saved session.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    const content = composer.trim();
    setComposer("");
    setStatus("");
    setIsSending(true);
    let optimisticUserId = "";
    let pendingAssistantId = "";
    try {
      const activeSession = session ?? (await createSession()).session;
      if (!session) {
        window.localStorage.setItem(SESSION_KEY, activeSession.id);
        replaceSessionInList(activeSession);
        setSession(activeSession);
      }
      const optimisticUser: ChatMessage = {
        id: `local-${Date.now()}`,
        sessionId: activeSession.id,
        role: "user",
        text: content,
        createdAt: new Date().toISOString(),
      };
      const pendingAssistant: ChatMessage = {
        id: `pending-${Date.now()}`,
        sessionId: activeSession.id,
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
        metadata: { pending: true },
      };
      optimisticUserId = optimisticUser.id;
      pendingAssistantId = pendingAssistant.id;
      setMessages((current) => [...current, optimisticUser, pendingAssistant]);
      const response = await sendMessage(activeSession.id, content);
      const updatedSession = response.session ?? autoTitleSession(activeSession, content);
      setSession(updatedSession);
      replaceSessionInList(updatedSession);
      setTitleDraft(updatedSession.title || "Chat");
      setMessages((current) => [
        ...current.filter(
          (message) => message.id !== optimisticUser.id && message.id !== pendingAssistant.id,
        ),
        response.userMessage,
        {
          ...response.assistantMessage,
          citations: response.assistantMessage.citations?.length ? response.assistantMessage.citations : response.citations,
        },
      ]);
    } catch (error) {
      setMessages((current) => current.filter(
        (message) => message.id !== optimisticUserId && message.id !== pendingAssistantId,
      ));
      setStatus(error instanceof Error ? error.message : "Message failed.");
      setComposer(content);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSaveSessionTitle() {
    if (skipTitleSaveRef.current) {
      skipTitleSaveRef.current = false;
      return;
    }
    if (!session) return;
    const nextTitle = titleDraft.trim();
    const currentTitle = session.title || "New chat";
    setIsEditingTitle(false);
    if (!nextTitle) {
      setTitleDraft(currentTitle);
      return;
    }
    if (nextTitle === currentTitle) return;
    setIsSavingTitle(true);
    setStatus("");
    try {
      const updatedSession = await updateSessionTitle(session.id, nextTitle);
      setSession(updatedSession);
      replaceSessionInList(updatedSession);
      setTitleDraft(updatedSession.title);
      setStatus("Subject saved.");
    } catch (error) {
      setTitleDraft(currentTitle);
      setStatus(error instanceof Error ? error.message : "Could not save subject.");
    } finally {
      setIsSavingTitle(false);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const nextTitle = titleDraft.trim();
      const currentTitle = session?.title || "New chat";
      if (session && nextTitle && nextTitle !== currentTitle) {
        void handleSaveSessionTitle();
        skipTitleSaveRef.current = true;
      }
      event.currentTarget.querySelector("input")?.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipTitleSaveRef.current = true;
      setTitleDraft(session?.title || "Chat");
      setIsEditingTitle(false);
      event.currentTarget.blur();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const target = event.target instanceof HTMLElement ? event.target : null;
      target?.closest("form")?.requestSubmit();
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!session || !files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const uploadableFiles: File[] = [];
    for (const file of selectedFiles) {
      const filename = file.name || "upload.bin";
      const extension = filename.includes(".") ? `.${filename.split(".").pop()?.toLowerCase()}` : "";
      if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
        showToast(`Unsupported file type: ${filename}`, "error");
        continue;
      }
      if (file.size === 0) {
        if (TEXT_UPLOAD_EXTENSIONS.has(extension)) {
          const text = await file.text();
          if (text.length > 0) {
            uploadableFiles.push(new File([text], filename, { type: file.type || "text/plain", lastModified: file.lastModified }));
            continue;
          }
        }
      }
      uploadableFiles.push(file);
    }
    if (uploadableFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setIsUploading(true);
    setStatus("");
    try {
      const uploaded = await uploadDocuments(session.id, uploadableFiles);
      setDocuments((current) => [...current, ...uploaded]);
      showToast(`${uploaded.length} document${uploaded.length === 1 ? "" : "s"} ready for analysis.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upload failed.", "error");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDropzoneDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!session || isUploading) return;
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFiles(true);
  }

  function handleDropzoneDragLeave() {
    setIsDraggingFiles(false);
  }

  function handleDropzoneDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);
    if (!session || isUploading) return;
    void handleFiles(event.dataTransfer.files);
  }

  async function handleDeleteDocument(documentId: string) {
    if (!session) return;
    await deleteDocument(session.id, documentId);
    setDocuments((current) => current.filter((document) => document.id !== documentId));
  }

  async function handleClearHistory() {
    if (!session) return;
    setIsLoading(true);
    setStatus("");
    try {
      const result = await clearHistory(session.id);
      await loadSessionState(session.id);
      showToast(`${result.messageCount} message${result.messageCount === 1 ? "" : "s"} cleared.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear chat history.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteSession(event: FormEvent) {
    event.preventDefault();
    const requestedSessionId = deleteSessionId.trim();
    if (!requestedSessionId) {
      setStatus("Enter a session ID to delete.");
      return;
    }
    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      return;
    }
    setIsLoading(true);
    setStatus("");
    try {
      await deleteSession(requestedSessionId);
      setSessions((current) => current.filter((savedSession) => savedSession.id !== requestedSessionId));
      if (!session || requestedSessionId === session.id) {
        window.localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setMessages([]);
        setDocuments([]);
        setTitleDraft("Chat");
        setComposer("");
      }
      setDeleteSessionId("");
      setIsDeleteConfirming(false);
      setIsDeletePanelOpen(false);
      setIsResumePanelOpen(false);
      setIsMenuOpen(false);
      showToast("Session deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete session.");
    } finally {
      setIsLoading(false);
    }
  }

  function showToast(text: string, tone: ToastMessage["tone"] = "success") {
    const now = Date.now();
    setToast({ id: now, text, tone, createdAt: now });
  }

  function handleSidebarResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (isSidebarCollapsed) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth, moved: false };
    setIsSidebarResizing(true);
  }

  function handleSidebarResizeMove(event: React.PointerEvent<HTMLButtonElement>) {
    const resize = sidebarResizeRef.current;
    if (!resize) return;
    const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, resize.startWidth + event.clientX - resize.startX));
    if (Math.abs(event.clientX - resize.startX) > 3) {
      resize.moved = true;
    }
    setSidebarWidth(nextWidth);
  }

  function handleSidebarResizeEnd(event: React.PointerEvent<HTMLButtonElement>) {
    if (!sidebarResizeRef.current) return;
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsSidebarResizing(false);
  }

  function handleSidebarToggle() {
    if (sidebarResizeRef.current?.moved) {
      sidebarResizeRef.current = null;
      return;
    }
    sidebarResizeRef.current = null;
    setIsSidebarCollapsed(true);
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        className={`app-shell${isSidebarCollapsed ? " sidebar-collapsed" : ""}${isSidebarResizing ? " sidebar-resizing" : ""}`}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <Box component="aside" className={`sidebar${isResumePanelOpen ? " resume-open" : ""}${isMenuOpen ? " menu-open" : ""}${isSidebarCollapsed ? " sidebar-hidden" : ""}`}>
          <Box
            component="input"
            id="document-files-input"
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            aria-label="Document files"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => void handleFiles(event.target.files)}
          />
          <Box className="collapsed-sidebar-rail">
            <IconButton
              type="button"
              title="Show sessions"
              aria-label="Show sessions"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <SmsIcon fontSize="small" />
            </IconButton>
            <IconButton
              type="button"
              title="Show documents"
              aria-label="Show documents"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <DescriptionIcon fontSize="small" />
            </IconButton>
            <IconButton
              className="collapsed-sidebar-expand"
              type="button"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box className="brand-block">
            <Box>
              <Typography component="h1" variant="h6" fontWeight={750}>Web Chat</Typography>
              <Typography variant="body2" color="text.secondary">Generic assistant with document analysis</Typography>
            </Box>
            <Box className="brand-actions">
              <IconButton
                className="close-menu-button"
                type="button"
                title="Close menu"
                aria-label="Close menu"
                onClick={() => setIsMenuOpen(false)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          <IconButton
            className="collapse-sidebar-button"
            type="button"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            aria-expanded={!isSidebarCollapsed}
            aria-controls="sidebar-content"
            onPointerDown={handleSidebarResizeStart}
            onPointerMove={handleSidebarResizeMove}
            onPointerUp={handleSidebarResizeEnd}
            onPointerCancel={handleSidebarResizeEnd}
            onClick={handleSidebarToggle}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>

          <Box component="section" className="session-panel" id="sidebar-content">
            <Stack spacing={1.25}>
              <Button
                aria-expanded={isSessionSectionOpen}
                aria-controls="session-details"
                fullWidth
                variant="text"
                startIcon={<SmsIcon color="action" fontSize="small" sx={{ display: "block" }} />}
                endIcon={isSessionSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                onClick={() => setIsSessionSectionOpen((current) => !current)}
                sx={{ color: "text.primary", fontWeight: 700, justifyContent: "flex-start", px: 1, textAlign: "left" }}
              >
                <Box component="span" sx={{ flex: 1 }}>Sessions</Box>
                <Chip
                  aria-label={`${sessions.length} sessions`}
                  label={sessions.length}
                  size="small"
                  variant="outlined"
                  sx={{ alignSelf: "center", borderRadius: 999, height: 22, minWidth: 28 }}
                />
              </Button>
              {isSessionSectionOpen ? (
                <Box className="session-subitems session-list" id="session-details">
                  {sessions.map((savedSession) => (
                    <Box className="session-list-row" key={savedSession.id}>
                      <Button
                        className={`session-list-item${savedSession.id === session?.id ? " active" : ""}`}
                        fullWidth
                        variant="text"
                        onClick={() => void handleSelectSession(savedSession.id)}
                        disabled={isLoading}
                        title={savedSession.id}
                        sx={{ justifyContent: "flex-start", minWidth: 0, px: 1 }}
                      >
                        <Box component="span" className="session-list-title">{savedSession.title}</Box>
                      </Button>
                      <IconButton
                        size="small"
                        type="button"
                        title={`Delete ${savedSession.title}`}
                        aria-label={`Delete ${savedSession.title}`}
                        disabled={isLoading}
                        onClick={() => handleOpenDeleteSession(savedSession.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Stack>
          </Box>

          <Box component="section" className="upload-panel">
            <Stack spacing={1.25}>
              <Box className="documents-heading">
                <DescriptionIcon color="action" fontSize="small" />
                <Box component="span" sx={{ flex: 1 }}>Documents</Box>
                <Chip
                  aria-label={documentCountLabel}
                  label={documents.length}
                  size="small"
                  variant="outlined"
                  sx={{ borderRadius: 999, height: 22, minWidth: 28 }}
                />
              </Box>
              <Stack id="documents-panel" spacing={1}>
                <Paper
                  component="div"
                  className={`document-dropzone${isDraggingFiles ? " dragging" : ""}`}
                  variant="outlined"
                  role="button"
                  tabIndex={session && !isUploading ? 0 : -1}
                  aria-label="Upload documents"
                  aria-disabled={!session || isUploading}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!session || isUploading) return;
                    fileInputRef.current?.click();
                  }}
                  onDragEnter={handleDropzoneDragOver}
                  onDragOver={handleDropzoneDragOver}
                  onDragLeave={handleDropzoneDragLeave}
                  onDrop={handleDropzoneDrop}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (!session || isUploading) return;
                    fileInputRef.current?.click();
                  }}
                >
                  {isUploading ? <CircularProgress size={20} /> : <DriveFolderUploadIcon fontSize="small" />}
                  <Box minWidth={0}>
                    <Typography variant="body2" fontWeight={700}>Drop files here</Typography>
                    <Typography variant="caption" color="text.secondary">or click to browse</Typography>
                  </Box>
                </Paper>
                <Stack className="document-list" spacing={1}>
                  {documents.map((document) => (
                    <Paper className="document-row" variant="outlined" key={document.id}>
                      <DescriptionIcon fontSize="small" />
                      <Box minWidth={0}>
                        <Typography component="div" className="document-name" variant="body2" fontWeight={700}>
                          {document.filename} <Box component="span" className="document-size">({formatBytes(document.size)})</Box>
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        title="Delete document"
                        aria-label={`Delete ${document.filename}`}
                        onClick={() => void handleDeleteDocument(document.id)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Paper>
                  ))}
                </Stack>
              </Stack>
            </Stack>
          </Box>
        </Box>

        <Dialog open={isResumePanelOpen} onClose={handleCloseResumeSession} aria-labelledby="resume-session-title" fullWidth maxWidth="xs">
          <Box component="form" onSubmit={(event: FormEvent) => void handleResumeSession(event)}>
            <DialogTitle id="resume-session-title">Resume a saved chat</DialogTitle>
            <DialogContent>
              <DialogContentText>Paste a session ID to switch back to that conversation.</DialogContentText>
              <TextField
                inputRef={resumeInputRef}
                label="Resume session ID"
                value={resumeSessionId}
                onChange={(event) => setResumeSessionId(event.target.value)}
                placeholder="Paste session ID"
                disabled={isLoading}
                fullWidth
                margin="normal"
              />
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={handleCloseResumeSession} disabled={isLoading}>Cancel</Button>
              <Button variant="contained" type="submit" disabled={isLoading}>Resume chat</Button>
            </DialogActions>
          </Box>
        </Dialog>

        <Dialog open={isDeletePanelOpen} onClose={handleCloseDeleteSession} aria-labelledby="delete-session-title" fullWidth maxWidth="xs">
          <Box component="form" onSubmit={(event: FormEvent) => void handleDeleteSession(event)}>
            <DialogTitle id="delete-session-title">Delete a saved chat</DialogTitle>
            <DialogContent>
              <DialogContentText>This will delete the saved chat and cannot be undone.</DialogContentText>
              <Alert severity="error" role="alert" sx={{ mt: 1 }}>
                Delete session {deleteSessionId.trim()}?
              </Alert>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={handleCloseDeleteSession} disabled={isLoading}>Cancel</Button>
              <Button color="error" variant="contained" type="submit" disabled={isLoading}>
                {isDeleteConfirming ? "Confirm delete" : "Delete"}
              </Button>
            </DialogActions>
          </Box>
        </Dialog>

        {isMenuOpen && (
          <Backdrop className="menu-backdrop" open aria-label="Close menu" onClick={() => setIsMenuOpen(false)} />
        )}

        <Snackbar
          open={!!toast}
          autoHideDuration={TOAST_DURATION_MS}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          sx={{ top: "calc(var(--topbar-height) + 8px) !important" }}
        >
          <Alert
            role="status"
            severity={toast?.tone ?? "success"}
            variant="filled"
            onClose={() => setToast(null)}
            icon={
              <Box
                aria-label="Toast close countdown"
                sx={{ display: "grid", height: 28, placeItems: "center", position: "relative", width: 28 }}
              >
                <CircularProgress
                  color="inherit"
                  size={28}
                  thickness={4}
                  value={toastCountdown}
                  variant="determinate"
                />
                <Typography
                  component="span"
                  color="inherit"
                  sx={{ fontSize: 10, fontWeight: 800, lineHeight: 1, position: "absolute" }}
                >
                  {Math.ceil((toastCountdown / 100) * (TOAST_DURATION_MS / 1000))}
                </Typography>
              </Box>
            }
          >
            {toast?.text}
          </Alert>
        </Snackbar>

        <Box component="section" className="chat-panel">
          <Box component="header" className="chat-header">
            <Box className="chat-header-inner">
              <Stack direction="row" alignItems="center" spacing={1.5} minWidth={0}>
                <IconButton
                  className="menu-button"
                  type="button"
                  title="Open menu"
                  aria-label="Open menu"
                  onClick={() => {
                    setIsSidebarCollapsed(false);
                    setIsMenuOpen(true);
                  }}
                >
                  <MenuIcon fontSize="small" />
                </IconButton>
                <Box minWidth={0}>
                  <TextField
                    className="chat-title-input"
                    value={titleDraft}
                    slotProps={{ htmlInput: { "aria-label": "Chat subject", maxLength: 80 } }}
                    disabled={!session || isSavingTitle}
                    onFocus={() => setIsEditingTitle(true)}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => void handleSaveSessionTitle()}
                    onKeyDown={handleTitleKeyDown}
                    variant="standard"
                  />
                  {session ? (
                    <Stack direction="row" alignItems="center" spacing={0.75} className="chat-session-subtitle">
                      <Typography variant="body2" color="text.secondary">Session:</Typography>
                      <Box component="code" className="session-id">{session.id}</Box>
                      <IconButton
                        size="small"
                        type="button"
                        title="Copy session ID"
                        aria-label="Copy session ID"
                        className="session-copy-button"
                        onClick={() => void handleCopySessionId()}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">Starting session</Typography>
                  )}
                </Box>
              </Stack>
              <Box className="chat-header-actions">
                <Button size="small" variant="outlined" startIcon={<AddCommentIcon />} title="New Chat" aria-label="New Chat" onClick={() => void handleNewChat()} disabled={isLoading}>
                  New Chat
                </Button>
                <Button size="small" variant="outlined" startIcon={<RefreshIcon />} title="Resume" aria-label="Resume" onClick={handleOpenResumeSession} disabled={isLoading}>
                  Resume
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DeleteIcon fontSize="small" />}
                  type="button"
                  title="Clear messages"
                  aria-label="Clear messages"
                  disabled={!session || isLoading}
                  onClick={() => void handleClearHistory()}
                >
                  Clear
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteIcon />}
                  type="button"
                  title="Delete session"
                  aria-label="Delete session"
                  disabled={!session || isLoading}
                  onClick={() => handleOpenDeleteSession()}
                >
                  Delete
                </Button>
                {status ? <Chip label={status} size="small" variant="outlined" /> : null}
              </Box>
            </Box>
          </Box>

          <Box className="message-list" ref={messagesRef}>
            <Box className="message-list-inner">
              {isLoading ? (
                <Box className="center-state">
                  <CircularProgress size={22} />
                </Box>
              ) : messages.length === 0 ? (
                <Box className="empty-chat">
                  <Typography component="h3" variant="h4" fontWeight={650}>What can I help with?</Typography>
                  <Box className="starter-prompts" aria-label="Starter prompts">
                    {STARTER_PROMPTS.map((prompt) => (
                      <Button type="button" variant="outlined" key={prompt} onClick={() => setComposer(prompt)}>
                        {prompt}
                      </Button>
                    ))}
                  </Box>
                </Box>
              ) : (
                messages.map((message) => (
                  <Box component="article" className={`message ${message.role}`} key={message.id}>
                    <Typography className="message-role" variant="caption">{message.role === "user" ? "You" : "Assistant"}</Typography>
                    {message.metadata?.pending ? (
                      <Stack className="typing" direction="row">
                        <Box component="span" />
                        <Box component="span" />
                        <Box component="span" />
                      </Stack>
                    ) : (
                      <>
                        <Typography className="message-content" component="div">{formatMessageText(message)}</Typography>
                        {message.citations?.length ? (
                          <Stack className="message-citations" direction="row" flexWrap="wrap" aria-label="Citations">
                            {message.citations.map((citation) => (
                              <Chip className="citation-chip" key={formatCitation(citation)} component="span" size="small" variant="outlined" label={formatCitation(citation)} />
                            ))}
                          </Stack>
                        ) : null}
                      </>
                    )}
                  </Box>
                ))
              )}
            </Box>
          </Box>

          <Box component="form" className="composer" onSubmit={(event: FormEvent) => void handleSubmit(event)}>
            <Paper className="composer-inner" elevation={2}>
              <Box className="composer-input">
                <TextField
                  value={composer}
                  placeholder="Message the assistant..."
                  multiline
                  minRows={2}
                  maxRows={6}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  disabled={isLoading}
                  variant="standard"
                  fullWidth
                  InputProps={{ disableUnderline: true }}
                />
                <Stack className="token-usage" direction="row" flexWrap="wrap" aria-live="polite">
                  <Typography component="span" variant="caption">Draft: ~{draftTokenCount} tokens</Typography>
                  <Typography component="span" variant="caption">{formatTokenUsage("Session", sessionTokenUsage)}</Typography>
                  {lastTokenUsage ? <Typography component="span" variant="caption">{formatTokenUsage("Last response", lastTokenUsage)}</Typography> : null}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1} alignSelf="start">
                <IconButton
                  type="button"
                  title="Attach documents"
                  aria-label="Attach documents"
                  disabled={!session || isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AttachFileIcon fontSize="small" />
                </IconButton>
                <IconButton color="primary" type="submit" aria-label="Send message" disabled={!canSend}>
                  {isSending ? <CircularProgress size={19} /> : <SendIcon fontSize="small" />}
                </IconButton>
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

async function createSession(): Promise<{ session: ChatSession }> {
  return api("/api/sessions", { method: "POST" });
}

async function listSessions(): Promise<ChatSession[]> {
  return api("/api/sessions");
}

async function getSession(sessionId: string): Promise<SessionState> {
  return api(`/api/sessions/${sessionId}`);
}

async function listMessages(sessionId: string): Promise<MessagesResponse> {
  return api(`/api/sessions/${sessionId}/messages`);
}

async function sendMessage(sessionId: string, content: string): Promise<SendMessageResponse> {
  return api(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

async function updateSessionTitle(sessionId: string, title: string): Promise<ChatSession> {
  return api(`/api/sessions/${sessionId}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

async function uploadDocuments(sessionId: string, files: File[]): Promise<DocumentRecord[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return api(`/api/sessions/${sessionId}/documents`, {
    method: "POST",
    body: formData,
  });
}

async function deleteDocument(sessionId: string, documentId: string) {
  return api(`/api/sessions/${sessionId}/documents/${documentId}`, { method: "DELETE" });
}

async function clearHistory(sessionId: string): Promise<{ sessionId: string; clearedAt: string; messageCount: number }> {
  return api(`/api/sessions/${sessionId}/history`, { method: "DELETE" });
}

async function deleteSession(sessionId: string): Promise<{ sessionId: string; deleted: boolean }> {
  return api(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = `Request failed with HTTP ${response.status}`;
    try {
      const data = await response.json();
      detail = typeof data.detail === "string" ? data.detail : detail;
    } catch {
      // Keep default detail.
    }
    throw new Error(detail);
  }
  return response.json();
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCitation(citation: SourceCitation | string) {
  if (typeof citation === "string") return `Source: ${citation}`;
  if (citation.lineStart && citation.lineEnd) {
    if (citation.lineStart === citation.lineEnd) return `Source: ${citation.filename}, line ${citation.lineStart}`;
    return `Source: ${citation.filename}, lines ${citation.lineStart}-${citation.lineEnd}`;
  }
  return `Source: ${citation.filename}`;
}

function formatMessageText(message: ChatMessage) {
  if (!message.citations?.length) return message.text;
  const citedFilenames = new Set(message.citations.map((citation) => typeof citation === "string" ? citation : citation.filename).filter(Boolean));
  const lines = message.text.split(/\r?\n/);
  while (lines.length > 0) {
    const line = lines[lines.length - 1].trim();
    const sourceMatch = line.match(/^source(?:s)?:\s*`?([^`]+?)`?\.?$/i);
    if (!sourceMatch || !citedFilenames.has(sourceMatch[1].trim())) break;
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function summarizeTokenUsage(messages: ChatMessage[]): TokenUsage {
  const usageValues = messages.map(readTokenUsage).filter((usage): usage is TokenUsage => usage !== null);
  if (usageValues.length > 0) {
    return usageValues.reduce<TokenUsage>(
      (total, usage) => ({
        promptTokens: (total.promptTokens || 0) + (usage.promptTokens || 0),
        completionTokens: (total.completionTokens || 0) + (usage.completionTokens || 0),
        totalTokens: (total.totalTokens || 0) + (usage.totalTokens || 0),
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );
  }
  return {
    totalTokens: messages.reduce((total, message) => total + estimateTokens(message.text), 0),
    estimated: true,
  };
}

function latestTokenUsage(messages: ChatMessage[]) {
  for (const message of [...messages].reverse()) {
    const usage = readTokenUsage(message);
    if (usage) return usage;
  }
  return null;
}

function readTokenUsage(message: ChatMessage): TokenUsage | null {
  const value = message.metadata?.tokenUsage;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const promptTokens = readNumber(usage.promptTokens);
  const completionTokens = readNumber(usage.completionTokens);
  const totalTokens = readNumber(usage.totalTokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatTokenUsage(label: string, usage: TokenUsage) {
  const total = usage.totalTokens ?? (usage.promptTokens || 0) + (usage.completionTokens || 0);
  const prefix = usage.estimated ? `~${total}` : `${total}`;
  if (usage.promptTokens || usage.completionTokens) {
    return `${label}: ${prefix} tokens (${usage.promptTokens || 0} in / ${usage.completionTokens || 0} out)`;
  }
  return `${label}: ${prefix} tokens`;
}

function autoTitleSession(session: ChatSession, content: string): ChatSession {
  if (session.title && session.title !== "New chat") return session;
  const title = content.trim().replace(/\s+/g, " ").slice(0, 60) || "New chat";
  return { ...session, title };
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

