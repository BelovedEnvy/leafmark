"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ArrowUp,
  BookMarked,
  Bookmark,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  CircleHelp,
  FilePlus2,
  FileText,
  GitFork,
  LibraryBig,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquareText,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Citation, Selection } from "./PdfPane";
import "./workspace.css";

const PdfPane = dynamic(() => import("./PdfPane"), { ssr: false });
const Benchmarks = dynamic(() => import("./Benchmarks"), { ssr: false });
const sampleDocument = { id: "sample", name: "Alder Beck Field Station", url: "/sample.pdf" };
const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase = authUrl && publishable ? createClient(authUrl, publishable) : null;

type DocumentInfo = typeof sampleDocument & { status?: "ready" | "pending" | "deleting" };
export type Answer = {
  text: string;
  citations: Citation[];
  groundedness_score: number | null;
  topics?: string[];
  abstained?: boolean;
  latency_ms?: number;
  verification_failed?: boolean;
  trace?: {chunk_id:string;file_name:string;page:number;hybrid_rank:number;reranker_score:number}[];
};
type Turn = { question: string; answer: Answer };
type Library = {
  documents: DocumentInfo[];
  sample: Turn | null;
  suggestions: string[];
  configured: boolean;
};
type Panel = "benchmarks" | "upload" | "account" | "delete";

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(
  path: string,
  token: string | undefined,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new RequestError(
      typeof value.error === "string"
        ? value.error
        : "The request could not be completed. Please try again.",
      response.status,
    );
  return value as T;
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function InlineAnswer({ answer, select, fileName }: { answer: Answer; select: (citation: Citation) => void; fileName:string }) {
  return (
    <div className="answer-prose">
      {answer.text
        .split(/\n+/)
        .filter(Boolean)
        .map((line, i) => (
          <p key={i}>
            {line.split(/(\[\d+\])/g).map((part, j) => {
              const citation =
                /^\[(\d+)\]$/.test(part) &&
                answer.citations.find((c) => c.id === Number(part.slice(1, -1)));
              return citation ? (
                <span className="citation-wrap" key={j}>
                <button
                  key={j}
                  type="button"
                  className="inline-cite"
                  aria-label={`Open source ${citation.id}, page ${citation.page}`}
                  aria-describedby={`citation-peek-${i}-${j}`}
                  onClick={() => select(citation)}
                >
                  {part}
                </button>
                <span className="citation-peek" role="tooltip" id={`citation-peek-${i}-${j}`}>
                  <span>{citation.file_name ?? fileName} · Page {citation.page}</span>
                  <span>Relevance {citation.reranker_score == null ? "Unavailable" : citation.reranker_score.toFixed(3)}</span>
                  <q>{citation.verbatim_quote}</q>
                </span>
                </span>
              ) : (
                part
              );
            })}
          </p>
        ))}
    </div>
  );
}

export default function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [library, setLibrary] = useState<Library>({
    documents: [sampleDocument],
    sample: null,
    suggestions: [],
    configured: false,
  });
  const [documentId, setDocumentId] = useState("sample");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [mobilePdf, setMobilePdf] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("semantic");
  const [overlap, setOverlap] = useState("0");
  const [uploadStage, setUploadStage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  const authIdentity = useRef<string | undefined>(undefined);
  const uploadKey = useRef<{
    file: File;
    id: string;
    path: string;
    user: string;
    stored: boolean;
    mode: string;
    overlap: number;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const current: DocumentInfo = library.documents.find((d) => d.id === documentId) ?? sampleDocument;
  const ready = Boolean(current.url);
  const example = documentId === "sample" ? library.sample : null;
  const shown = turn ?? example;
  const answer = shown?.answer;
  const token = session?.access_token;

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, updated) => {
      if (authIdentity.current !== updated?.user.id) {
        authIdentity.current = updated?.user.id;
        revision.current++;
        setLibrary((l) => ({ ...l, documents: [sampleDocument] }));
        setDocumentId("sample");
        setTurn(null);
        setSelection(null);
        setQuestion("");
        setPendingQuestion("");
        setPanel(null);
        setNotice("");
        setError("");
        setFile(null);
        uploadKey.current = null;
      }
      setSession(updated);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingLibrary(true);
    void request<Library>("/api/documents", token)
      .then((data) => {
        if (active) {
          setLibrary(data);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(reason(err));
      })
      .finally(() => {
        if (active) setLoadingLibrary(false);
      });
    return () => {
      active = false;
    };
  }, [token, refresh]);

  useEffect(() => {
    const first = shown?.answer.citations[0];
    setSelection(first ? { citation: first, revision: 0 } : null);
  }, [shown]);

  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target=event.target as HTMLElement | null;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || panel ||
          target?.isContentEditable || target?.closest('input, textarea, select, dialog')) return;
      if (event.key === '/' && ready) { event.preventDefault(); input.current?.focus(); }
      const citation=shown?.answer.citations.find(c=>String(c.id)===event.key);
      if (citation && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        setSelection(s=>({citation,revision:(s?.revision??0)+1}));
        setMobilePdf(true);
      }
    }
    window.addEventListener('keydown',shortcut);
    return () => window.removeEventListener('keydown',shortcut);
  }, [panel,ready,shown]);

  function choose(id: string) {
    revision.current++;
    setPendingQuestion("");
    setDocumentId(id);
    setTurn(null);
    setSelection(null);
    setQuestion("");
    setError("");
    setNotice("");
    setMobilePdf(false);
  }

  function select(citation: Citation) {
    setSelection((s) => ({ citation, revision: (s?.revision ?? 0) + 1 }));
    setMobilePdf(true);
  }

  function open(panel: Panel) {
    setActionError("");
    setPanel(panel);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (value.length < 2 || pendingQuestion || !ready) return;
    setError("");
    setNotice("");
    setPendingQuestion(value);
    setMobilePdf(false);
    const id = ++revision.current;
    try {
      const response = await request<Answer>("/api/ask", token, "POST", { documentId, question: value });
      if (id === revision.current) {
        setTurn({ question: value, answer: response });
        setQuestion("");
      }
    } catch (err) {
      if (id === revision.current) setError(reason(err));
    } finally {
      if (id === revision.current) setPendingQuestion("");
    }
  }

  async function signIn() {
    if (!supabase) return;
    setBusy(true);
    setActionError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      setActionError(reason(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !session || !supabase || busy) return;
    setBusy(true);
    setActionError("");
    const user = session.user.id;
    try {
      if (!file.size || file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf"))
        throw new Error("Choose a PDF up to 10 MB.");
      let uploaded = uploadKey.current;
      if (uploaded?.file !== file || uploaded.user !== user) {
        const settings = { name: file.name, mode, overlap: mode === "fixed" ? Number(overlap) : 0 };
        const slot = await request<{ id: string; path: string }>(
          "/api/uploads",
          token,
          "POST",
          settings,
        );
        uploaded = { ...slot, file, user, stored: false, mode, overlap: settings.overlap };
        uploadKey.current = uploaded;
      }
      if (!uploaded.stored) {
        setUploadStage("Uploading PDF…");
        const { error } = await supabase.storage
          .from("pdfs")
          .upload(uploaded.path, file, { contentType: "application/pdf", upsert: false });
        if (error) throw error;
        uploaded.stored = true;
      }
      setUploadStage("Indexing passages…");
      const result = await request<{ document: DocumentInfo; notice?: string }>(
        "/api/documents",
        token,
        "POST",
        { path: uploaded.path, name: file.name, mode: uploaded.mode, overlap: uploaded.overlap },
      );
      if (authIdentity.current !== user) return;
      setLibrary((l) => ({
        ...l,
        documents: [...l.documents.filter((d) => d.id !== result.document.id), result.document],
      }));
      choose(result.document.id);
      setPanel(null);
      setFile(null);
      uploadKey.current = null;
      setNotice(result.notice ?? "PDF indexed. You can now ask a question.");
    } catch (err) {
      const incomplete=uploadKey.current;
      if (err instanceof RequestError && (err.status === 400 || err.status === 422) && incomplete?.stored) {
        try {
          await request('/api/documents', token, 'DELETE', {id:incomplete.id});
          uploadKey.current=null;
        } catch {
          setActionError(reason(err) + ' Delete the incomplete PDF from the source panel.');
          setRefresh(r=>r+1);
          return;
        }
      }
      setActionError(reason(err));
      setRefresh((r) => r + 1);
    } finally {
      setBusy(false);
      setUploadStage("");
    }
  }

  async function remove() {
    if (documentId === "sample" || !session || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await request("/api/documents", token, "DELETE", { id: documentId });
      setLibrary((l) => ({ ...l, documents: l.documents.filter((d) => d.id !== documentId) }));
      choose("sample");
      setPanel(null);
      setNotice("PDF deleted.");
    } catch (err) {
      setActionError(reason(err));
    } finally {
      setBusy(false);
    }
  }

  const accountContent = session ? (
    <>
      <p className="dialog-copy">
        Signed in as {session.user.user_metadata.user_name ?? session.user.email ?? "a GitHub user"}.
      </p>
      <button
        type="button"
        className="secondary-button"
        onClick={async () => {
          const { error } = await supabase!.auth.signOut();
          if (error) setActionError(error.message);
        }}
      >
        <LogOut /> Sign out
      </button>
    </>
  ) : (
    <>
      <p className="dialog-copy">
        {supabase
          ? "Sign in with GitHub to upload and manage your private PDFs."
          : "Private uploads will be available once Supabase is connected. The sample PDF is open to everyone."}
      </p>
      {supabase && (
        <button type="button" className="primary-button" disabled={busy} onClick={() => void signIn()}>
          <GitFork /> Continue with GitHub
        </button>
      )}
    </>
  );

  return (
    <main className="leafmark">
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" aria-label="Leafmark workspace" className="brand">
            <span className="brand-mark">
              <BookMarked />
            </span>
            Leafmark
          </a>
          <nav className="main-nav" aria-label="Main navigation">
            <button
              type="button"
              className={panel !== "benchmarks" ? "nav-button active" : "nav-button"}
              onClick={() => setPanel(null)}
            >
              <LibraryBig /> Workspace
            </button>
            <button
              type="button"
              className={panel === "benchmarks" ? "nav-button active" : "nav-button"}
              onClick={() => open("benchmarks")}
            >
              <ChartNoAxesColumn /> Benchmarks
            </button>
          </nav>
          <button type="button" className="account-button" onClick={() => open("account")}>
            <LogIn />
            <span>{session ? "Account" : "Sign in"}</span>
          </button>
        </div>
      </header>
      <div className="workspace-shell">
        <div className="workspace-heading">
          <h1>
            Verify answers at the <em>source.</em>
          </h1>
          <button
            type="button"
            className="secondary-button upload-button"
            onClick={() => open("upload")}
          >
            <Upload /> Upload PDF
          </button>
        </div>
        <div className="mobile-switch" aria-label="Workspace panels">
          <button type="button" aria-pressed={!mobilePdf} onClick={() => setMobilePdf(false)}>
            <MessageSquareText /> Evidence
          </button>
          <button type="button" aria-pressed={mobilePdf} onClick={() => setMobilePdf(true)}>
            <FileText /> Source PDF
          </button>
        </div>
        <div className={`workspace-grid ${mobilePdf ? "show-source" : "show-evidence"}`}>
          <section aria-labelledby="evidence-title" className="panel evidence-panel">
            <div className="panel-title">
              <MessageSquareText />
              <h2 id="evidence-title">Question &amp; answer</h2>
            </div>
            <div className="evidence-scroll" aria-live="polite" aria-busy={!!pendingQuestion}>
              {notice && (
                <p className="notice" role="status">
                  <Check />
                  {notice}
                </p>
              )}
              {!ready ? (
                <div className="empty-answer">
                  <FileText />
                  <h3>
                    {current.status === "deleting" ? "Deletion in progress" : "Indexing incomplete"}
                  </h3>
                  <p>
                    {current.status === "deleting"
                      ? "Finish deleting this PDF from the source panel."
                      : "Retry the upload or delete the incomplete PDF from the source panel."}
                  </p>
                </div>
              ) : pendingQuestion ? (
                <>
                  <p className="question-text">{pendingQuestion}</p>
                  <p className="working">
                    <LoaderCircle className="spin" /> Searching the document…
                  </p>
                </>
              ) : shown && answer ? (
                <>
                  <h3 className="question-text">{shown.question}</h3>
                  {answer.verification_failed && (
                    <p className="error-box">
                      Some source quotes could not be verified. Check the document before relying on this
                      answer.
                    </p>
                  )}
                  {answer.abstained ? (
                    <div className="not-found">
                      <Search />
                      <h4>Not Found in Document</h4>
                      <p>The retrieved passages do not establish an answer.</p>
                      {!!answer.topics?.length && (
                        <>
                          <h5>Related topics in this PDF</h5>
                          <ul>
                            {answer.topics.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <InlineAnswer answer={answer} select={select} fileName={current.id === 'sample' ? 'Alder Beck Field Station.pdf' : current.name} />
                      {!!answer.citations.length && (
                        <div className="sources">
                          <h4>
                            <Link2 /> Sources <span>{answer.citations.length}</span>
                          </h4>
                          {answer.citations.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              className={`quote-card ${selection?.citation.id === c.id ? "selected" : ""}`}
                              onClick={() => select(c)}
                            >
                              <span className="quote-heading">
                                <span>
                                  <Bookmark /> Source [{c.id}]
                                </span>
                                <span>Page {c.page}</span>
                              </span>
                              <q>{c.verbatim_quote}</q>
                            </button>
                          ))}
                        </div>
                      )}
                      {answer.groundedness_score != null && (
                        <button
                          className="score-button"
                          type="button"
                          onClick={() => open("benchmarks")}
                        >
                          <Check />
                          Estimated groundedness <b>{Math.round(answer.groundedness_score * 100)}%</b>
                        </button>
                      )}
                    </>
                  )}
                  {!!answer.trace?.length && (
                    <details className="retrieval-trace">
                      <summary>Retrieval trace</summary>
                      <ol>{answer.trace.map(row => <li key={row.chunk_id}>
                        <span>{row.chunk_id} · page {row.page}</span>
                        <span>RRF rank {row.hybrid_rank} · score {row.reranker_score.toFixed(3)}</span>
                      </li>)}</ol>
                    </details>
                  )}
                </>
              ) : (
                <div className="empty-answer">
                  <CircleHelp />
                  <h3>{loadingLibrary ? "Opening workspace…" : "Ask about this PDF"}</h3>
                  {!loadingLibrary && <p>Choose a passage, term, or decision you want to check.</p>}
                </div>
              )}
              {error && (
                <div className="error-box" role="alert">
                  {error}
                  {!shown && (
                    <button
                      className="plain-button"
                      type="button"
                      onClick={() => setRefresh((r) => r + 1)}
                    >
                      Reload documents
                    </button>
                  )}
                </div>
              )}
            </div>
            <form className="composer" onSubmit={ask}>
              {documentId === "sample" && library.suggestions.length > 0 && (
                <div className="question-suggestions" aria-label="Suggested questions">
                  {library.suggestions
                    .filter((q) => q !== shown?.question)
                    .slice(0, 2)
                    .map((q) => (
                      <button
                        type="button"
                        key={q}
                        onClick={() => {
                          setQuestion(q);
                          input.current?.focus();
                        }}
                      >
                        {q}
                      </button>
                    ))}
                </div>
              )}
              <div className="composer-field">
                <textarea
                  disabled={!ready}
                  ref={input}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  minLength={2}
                  maxLength={700}
                  rows={2}
                  placeholder="Ask a question about this PDF…"
                  aria-label="Question about this PDF"
                />
                <div className="composer-bottom">
                  <span>
                    <FileText /> Current PDF <kbd>/</kbd> focus · <kbd>1–5</kbd> sources
                  </span>
                  <button
                    type="submit"
                    className="primary-button ask-button"
                    disabled={!ready || question.trim().length < 2 || !!pendingQuestion}
                  >
                    {pendingQuestion ? <LoaderCircle className="spin" /> : <ArrowUp />}Ask
                  </button>
                </div>
              </div>
            </form>
          </section>
          <section aria-label="Source document" className="panel source-panel">
            <div className="panel-title source-heading">
              <span className="doc-icon">
                <FileText />
              </span>
              <div className="source-label">
                <label htmlFor="document-selector">Source document</label>
                <div className="select-wrap">
                  <select
                    id="document-selector"
                    value={current.id}
                    onChange={(e) => choose(e.target.value)}
                  >
                    {library.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown />
                </div>
              </div>
              {current.id !== "sample" && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete selected PDF"
                  onClick={() => open("delete")}
                >
                  <Trash2 />
                </button>
              )}
            </div>
            {ready ? (
              <PdfPane
                key={current.id}
                url={current.url}
                name={current.name}
                selection={selection}
                refreshLink={() => setRefresh((r) => r + 1)}
              />
            ) : (
              <p className="dialog-inner field-note">
                The preview is available after indexing finishes.
              </p>
            )}
          </section>
        </div>
      </div>
      <dialog
        ref={dialog}
        className={`workspace-dialog ${panel === "benchmarks" ? "benchmark-dialog" : ""}`}
        aria-labelledby="dialog-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => setPanel(null)}
      >
        <div className="dialog-inner">
          <div className="dialog-heading">
            <h2 id="dialog-title">
              {panel === "benchmarks"
                ? "Benchmarks"
                : panel === "upload"
                  ? "Upload PDF"
                  : panel === "delete"
                    ? "Delete this PDF?"
                    : session
                      ? "Your account"
                      : "Sign in"}
            </h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close dialog"
              disabled={busy}
              onClick={() => setPanel(null)}
            >
              <X />
            </button>
          </div>
          {panel === "benchmarks" && <Benchmarks answer={answer} />}
          {(panel === "account" || (panel === "upload" && !session)) && accountContent}
          {panel === "upload" && session && (
            <form className="upload-form" onSubmit={upload}>
              <label className="file-input">
                <FilePlus2 />
                <span>{file?.name ?? "Choose a PDF"}</span>
                <input
                  aria-label="Choose a PDF file"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={busy}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setActionError("");
                  }}
                />
              </label>
              <p className="field-note">
                English, selectable text. Up to 10 MB and 50 pages. Model providers process passages to
                index and answer questions.
              </p>
              <label>
                Chunking
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  disabled={busy || uploadKey.current?.file === file}
                >
                  <option value="semantic">Semantic</option>
                  <option value="fixed">Fixed · 512 tokens</option>
                </select>
              </label>
              {mode === "fixed" && (
                <label>
                  Chunk overlap
                  <select
                    value={overlap}
                    onChange={(e) => setOverlap(e.target.value)}
                    disabled={busy || uploadKey.current?.file === file}
                  >
                    <option value="0">0%</option>
                    <option value="0.15">15%</option>
                  </select>
                </label>
              )}
              <button className="primary-button" disabled={!file || busy}>
                {busy ? <LoaderCircle className="spin" /> : <Upload />}
                {uploadStage || "Upload PDF"}
              </button>
            </form>
          )}
          {panel === "delete" && (
            <>
              <p className="dialog-copy">
                This removes {current.name} and its indexed passages from your workspace.
              </p>
              <button
                type="button"
                disabled={busy}
                className="secondary-button"
                onClick={() => void remove()}
              >
                <Trash2 /> Delete PDF
              </button>
            </>
          )}
          {actionError && (
            <p className="error-box" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </dialog>
    </main>
  );
}
