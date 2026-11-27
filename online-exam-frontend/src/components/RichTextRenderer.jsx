import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import api from "../api/axiosConfig";
import "katex/dist/katex.min.css";
import { InlineMath, BlockMath } from "react-katex";

const RichTextRenderer = ({ content, className = "", imageClassName = "" }) => {
  const [preview, setPreview] = useState(null);
  const [loadedImages, setLoadedImages] = useState({});
  const root = React.useRef(null);
  const closeButton = React.useRef(null);

  useEffect(() => {
    const references = [...new Set(String(content || "").match(/exam-image:\/\/[a-f0-9-]+\/[2-7]-[a-f0-9]{24}\.(?:png|jpeg)/g) || [])];
    let cancelled = false;
    setLoadedImages({});
    for (const reference of references) {
      const path = reference.replace("exam-image://", "");
      api.get(`/question-images/${path}`, { responseType: "blob" }).then(({ data }) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (!cancelled) setLoadedImages(previous => ({ ...previous, [reference]: reader.result }));
        };
        reader.readAsDataURL(data);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [content]);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onEscape = (event) => {
      if (event.key === "Escape") setPreview(null);
      if (event.key === "Tab") {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
      previousFocus?.focus?.();
    };
  }, [preview]);

  useEffect(() => {
    root.current?.querySelectorAll(".rich-text-html img").forEach((img) => {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", "Perbesar gambar soal");
    });
  }, [content, loadedImages]);

  if (!content) return null;
  const renderedContent = String(content).replace(/exam-image:\/\/[a-f0-9-]+\/[2-7]-[a-f0-9]{24}\.(?:png|jpeg)/g, reference => loadedImages[reference] || "");

  // Simple regex to find $...$ for inline and $$...$$ for block math
  const parts = renderedContent.split(/(\$\$.*?\$\$|\$.*?\$)/gs);

  return (
    <div
      ref={root}
      className={`rich-text-content prose max-w-none prose-slate ${className}`}
      onClick={(event) => {
        if (event.target?.tagName === "IMG") {
          event.preventDefault(); event.stopPropagation();
          setPreview({
            src: event.target.getAttribute("src"),
            alt: event.target.getAttribute("alt") || "Preview gambar soal",
          });
        }
      }}
      onKeyDown={(event) => {
        if (event.target?.tagName === "IMG" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setPreview({
            src: event.target.getAttribute("src"),
            alt: event.target.getAttribute("alt") || "Gambar soal",
          });
        }
      }}
    >
      {parts.map((part, index) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          return <BlockMath key={index}>{part.slice(2, -2)}</BlockMath>;
        } else if (part.startsWith("$") && part.endsWith("$")) {
          return <InlineMath key={index}>{part.slice(1, -1)}</InlineMath>;
        } else {
          return (
            <div
              key={index}
              className={`rich-text-html [&_img]:my-3 [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-200 [&_img]:shadow-sm ${imageClassName}`}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(part) }}
            />
          );
        }
      })}
      {preview && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gambar soal diperbesar"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950/90 p-4 sm:p-8"
          onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}
        >
          <button
            ref={closeButton}
            type="button"
            className="absolute right-4 top-4 min-h-11 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            onClick={() => setPreview(null)}
          >
            Tutup gambar
          </button>
          <img
            src={preview.src}
            alt={preview.alt}
            className="max-h-[82vh] max-w-full rounded-lg bg-white object-contain"
          />
          <p className="mt-3 text-center text-sm text-white">Tekan Esc atau klik area gelap untuk menutup</p>
        </div>,
        document.body
      )}
    </div>
  );
};

export default RichTextRenderer;
