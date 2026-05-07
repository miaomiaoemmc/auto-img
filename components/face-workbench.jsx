"use client";

import { useEffect, useRef, useState } from "react";

const IMAGE_FILE_PATTERN = /\.(jpg|jpeg|png|webp)$/i;

const STATUS_META = {
  queued: { label: "待检测", tone: "neutral" },
  detecting: { label: "检测中", tone: "info" },
  ready: { label: "待确认", tone: "accent" },
  processing: { label: "处理中", tone: "info" },
  processed: { label: "已完成", tone: "success" },
  no_face: { label: "无人脸", tone: "muted" },
  skipped: { label: "已跳过", tone: "muted" },
  error: { label: "出错", tone: "danger" }
};

const TOOL_META = {
  keep: {
    label: "保留工具",
    hint: "点选要保留的人脸"
  },
  erase: {
    label: "涂抹工具",
    hint: "点选要抹掉的人脸，可多选"
  }
};

function isImageFile(file) {
  return file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name);
}

function sortFiles(files) {
  return [...files].sort((left, right) => {
    const leftLabel = left.webkitRelativePath || left.name;
    const rightLabel = right.webkitRelativePath || right.name;
    return leftLabel.localeCompare(rightLabel, "zh-CN");
  });
}

function createQueueItems(files) {
  const timestamp = Date.now();
  return sortFiles(files)
    .filter(isImageFile)
    .map((file, index) => ({
      localId: `${timestamp}-${index}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      pathLabel: file.webkitRelativePath || file.name,
      status: "queued",
      detection: null,
      keepFaceId: null,
      eraseFaceIds: [],
      result: null,
      error: ""
    }));
}

function revokeQueueUrls(queue) {
  for (const item of queue) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}

function formatConfidence(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function basename(filename) {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function isSelectionMissing(item, tool) {
  if (!item?.detection?.faces?.length) {
    return false;
  }
  if (tool === "keep") {
    return item.detection.faces.length > 1 && item.keepFaceId == null;
  }
  return item.eraseFaceIds.length === 0;
}

function queueSummary(queue, tool) {
  const total = queue.length;
  const processed = queue.filter((item) => item.status === "processed").length;
  const waiting = queue.filter((item) => item.status === "queued" || item.status === "ready").length;
  const blocked = queue.filter((item) => item.status === "ready" && isSelectionMissing(item, tool)).length;
  const skipped = queue.filter((item) => item.status === "no_face" || item.status === "skipped").length;
  return { total, processed, waiting, blocked, skipped };
}

function nextReviewableId(queue, currentId) {
  if (!queue.length) {
    return null;
  }

  const currentIndex = Math.max(
    0,
    queue.findIndex((item) => item.localId === currentId)
  );
  const ordered = [...queue.slice(currentIndex + 1), ...queue.slice(0, currentIndex)];
  const next = ordered.find((item) => ["queued", "ready", "error"].includes(item.status));
  return next?.localId ?? null;
}

function modeLabel(mode) {
  return mode === "batch" ? "批量队列" : "单张工作区";
}

function promptForItem(item, tool) {
  if (!item) {
    return "先选择一张图片或一个文件夹。";
  }
  if (item.status === "detecting") {
    return "正在检测人脸。";
  }
  if (item.status === "processing") {
    return "正在生成结果。";
  }
  if (item.status === "error") {
    return item.error || "处理失败，请重试。";
  }
  if (item.status === "no_face") {
    return "这张图没有检测到人脸，可以跳过或继续下一张。";
  }
  if (!item.detection) {
    return "打开图片后会自动开始检测。";
  }
  if (!item.detection.faces.length) {
    return "没有检测到可用人脸。";
  }
  if (tool === "keep") {
    if (item.detection.faces.length > 1 && item.keepFaceId == null) {
      return "保留工具已启用，请点选要保留的人脸。";
    }
    return "已选定保留目标，可以保存这一页。";
  }
  if (item.eraseFaceIds.length === 0) {
    return "涂抹工具已启用，请点选要抹掉的人脸。";
  }
  return `已选择 ${item.eraseFaceIds.length} 张待抹除的人脸。`;
}

function downloadName(item, suffix) {
  return `${basename(item.name)}-${suffix}.jpg`;
}

export default function FaceWorkbench() {
  const [mode, setMode] = useState("single");
  const [tool, setTool] = useState("keep");
  const [queue, setQueue] = useState([]);
  const [activeItemId, setActiveItemId] = useState(null);
  const [globalError, setGlobalError] = useState("");
  const [faceRatio, setFaceRatio] = useState(0.45);

  const queueRef = useRef([]);
  const singleInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    return () => {
      revokeQueueUrls(queueRef.current);
    };
  }, []);

  const activeItem = queue.find((item) => item.localId === activeItemId) ?? null;
  const summary = queueSummary(queue, tool);

  useEffect(() => {
    if (!activeItemId && queue.length) {
      setActiveItemId(queue[0].localId);
    }
  }, [activeItemId, queue]);

  useEffect(() => {
    if (activeItem && activeItem.status === "queued") {
      void detectItem(activeItem.localId);
    }
  }, [activeItem]);

  function installQueue(nextFiles, nextMode) {
    const nextItems = createQueueItems(Array.from(nextFiles || []));
    revokeQueueUrls(queueRef.current);
    setQueue(nextItems);
    setMode(nextMode);
    setActiveItemId(nextItems[0]?.localId ?? null);
    setGlobalError(nextItems.length ? "" : "所选内容里没有可处理的图片。");
  }

  function updateQueueItem(localId, transform) {
    setQueue((current) =>
      current.map((item) => {
        if (item.localId !== localId) {
          return item;
        }
        return typeof transform === "function" ? transform(item) : { ...item, ...transform };
      })
    );
  }

  function getFacesByIndexes(faces, indexes) {
    const indexSet = new Set(indexes);
    return faces.filter((face) => indexSet.has(face.index));
  }

  async function detectItem(localId, force = false) {
    const item = queueRef.current.find((entry) => entry.localId === localId);
    if (!item) {
      return;
    }
    if (!force && (item.status === "detecting" || item.status === "processing")) {
      return;
    }

    updateQueueItem(localId, {
      status: "detecting",
      error: ""
    });

    try {
      const formData = new FormData();
      formData.append("file", item.file);

      const response = await fetch("/api/detect", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "检测失败。");
      }

      updateQueueItem(localId, (current) => {
        const faces = payload.faces || [];
        const validKeep = faces.some((face) => face.index === current.keepFaceId) ? current.keepFaceId : null;
        const validEraseFaceIds = current.eraseFaceIds.filter((faceId) =>
          faces.some((face) => face.index === faceId)
        );

        return {
          ...current,
          status: faces.length ? "ready" : "no_face",
          error: "",
          detection: {
            imageId: payload.imageId,
            image: {
              width: payload.image.width,
              height: payload.image.height,
              name: payload.image.name
            },
            faces
          },
          keepFaceId: faces.length === 1 ? faces[0].index : validKeep,
          eraseFaceIds: validEraseFaceIds
        };
      });
      setGlobalError("");
    } catch (error) {
      updateQueueItem(localId, {
        status: "error",
        error: error instanceof Error ? error.message : "检测失败。"
      });
      setGlobalError(error instanceof Error ? error.message : "检测失败。");
    }
  }

  async function saveCurrentItem(localId) {
    let item = queueRef.current.find((entry) => entry.localId === localId);
    if (!item) {
      return;
    }

    if (!item.detection && item.status === "queued") {
      await detectItem(localId);
      item = queueRef.current.find((entry) => entry.localId === localId);
    }

    if (!item?.detection?.faces?.length) {
      setGlobalError("这张图没有可处理的人脸。");
      return;
    }

    const keepFace =
      tool === "keep" && item.keepFaceId != null
        ? item.detection.faces.find((face) => face.index === item.keepFaceId)
        : null;
    const eraseFaces = tool === "erase" ? getFacesByIndexes(item.detection.faces, item.eraseFaceIds) : [];

    if (!keepFace && eraseFaces.length === 0) {
      setGlobalError("先用工具选人脸：保留一张，或者抹掉一张。");
      return;
    }

    updateQueueItem(localId, { status: "processing", error: "" });

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageId: item.detection.imageId,
          faceRatio,
          keepBox: keepFace?.box ?? null,
          eraseBoxes: eraseFaces.map((face) => face.box)
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "处理失败。");
      }

      updateQueueItem(localId, (current) => ({
        ...current,
        status: "processed",
        result: {
          ...(current.result ?? {}),
          ...payload
        },
        error: ""
      }));
      setGlobalError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "处理失败。";
      updateQueueItem(localId, {
        status: "error",
        error: message
      });
      setGlobalError(message);
    }
  }

  function goNextItem() {
    if (!activeItem) {
      return;
    }
    const nextId = nextReviewableId(queueRef.current, activeItem.localId);
    if (nextId) {
      setActiveItemId(nextId);
    }
  }

  function skipActiveItem() {
    if (!activeItem) {
      return;
    }
    updateQueueItem(activeItem.localId, { status: "skipped", error: "" });
    goNextItem();
  }

  function clearWorkspace() {
    revokeQueueUrls(queueRef.current);
    setQueue([]);
    setActiveItemId(null);
    setGlobalError("");
  }

  function selectFace(faceIndex) {
    if (!activeItem) {
      return;
    }

    if (tool === "keep") {
      updateQueueItem(activeItem.localId, { keepFaceId: faceIndex });
    } else {
      updateQueueItem(activeItem.localId, (current) => {
        const exists = current.eraseFaceIds.includes(faceIndex);
        return {
          ...current,
          eraseFaceIds: exists
            ? current.eraseFaceIds.filter((id) => id !== faceIndex)
            : [...current.eraseFaceIds, faceIndex]
        };
      });
    }

    setGlobalError("");
  }

  const currentPrompt = promptForItem(activeItem, tool);
  const saveDisabled =
    !activeItem ||
    activeItem.status === "detecting" ||
    activeItem.status === "processing" ||
    !activeItem.detection?.faces?.length ||
    isSelectionMissing(activeItem, tool);

  return (
    <main className="mailApp">
      <header className="topbar">
        <div className="brandBlock">
          <div className="brandGlyph">F</div>
          <div>
            <p className="brandEyebrow">Face Mailroom</p>
            <h1>像收件箱一样处理人脸图片</h1>
          </div>
        </div>

        <div className="summaryStrip">
          <div className="summaryChip">
            <span>总数</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="summaryChip">
            <span>已完成</span>
            <strong>{summary.processed}</strong>
          </div>
          <div className="summaryChip">
            <span>待处理</span>
            <strong>{summary.waiting}</strong>
          </div>
          <div className="summaryChip">
            <span>待选人</span>
            <strong>{summary.blocked}</strong>
          </div>
        </div>
      </header>

      <section className="workbenchShell">
        <aside className="leftRail">
          <div className="railPanel">
            <div className="segmented">
              <button
                className={mode === "single" ? "segment selected" : "segment"}
                onClick={() => setMode("single")}
                type="button"
              >
                单张
              </button>
              <button
                className={mode === "batch" ? "segment selected" : "segment"}
                onClick={() => setMode("batch")}
                type="button"
              >
                批量
              </button>
            </div>

            <button className="actionButton primary" onClick={() => singleInputRef.current?.click()} type="button">
              选择图片
            </button>
            <button className="actionButton" onClick={() => folderInputRef.current?.click()} type="button">
              选择文件夹
            </button>
            <button className="actionButton subtle" onClick={clearWorkspace} type="button">
              清空当前队列
            </button>

            <div className="toolPalette">
              <div className="toolPaletteHeader">
                <span className="fieldLabel">工具</span>
                <span className="toolHint">{TOOL_META[tool].hint}</span>
              </div>
              <div className="toolToggle">
                <button
                  className={tool === "keep" ? "toolButton selected" : "toolButton"}
                  onClick={() => setTool("keep")}
                  type="button"
                >
                  {TOOL_META.keep.label}
                </button>
                <button
                  className={tool === "erase" ? "toolButton selected" : "toolButton"}
                  onClick={() => setTool("erase")}
                  type="button"
                >
                  {TOOL_META.erase.label}
                </button>
              </div>
            </div>

            <div className="controlCluster">
              <label className="fieldLabel" htmlFor="face-ratio">
                输出人脸占比 {Math.round(faceRatio * 100)}%
              </label>
              <input
                id="face-ratio"
                max="0.7"
                min="0.3"
                onChange={(event) => setFaceRatio(Number(event.target.value))}
                step="0.01"
                type="range"
                value={faceRatio}
              />
            </div>
          </div>

          <div className="railPanel railListPanel">
            <div className="listPanelHeader">
              <div>
                <p className="sectionEyebrow">{modeLabel(mode)}</p>
                <h2>图片队列</h2>
              </div>
              <span className="countBadge">{summary.total}</span>
            </div>

            {queue.length ? (
              <div className="queueList">
                {queue.map((item, index) => {
                  const status = STATUS_META[item.status];
                  const isActive = item.localId === activeItemId;
                  const selectedCount = (item.keepFaceId != null ? 1 : 0) + item.eraseFaceIds.length;
                  return (
                    <button
                      className={isActive ? "queueItem active" : "queueItem"}
                      key={item.localId}
                      onClick={() => setActiveItemId(item.localId)}
                      type="button"
                    >
                      <div className="queueItemTop">
                        <span className="queueOrder">{index + 1}</span>
                        <span className={`statusDot ${status.tone}`}>{status.label}</span>
                      </div>
                      <strong>{item.name}</strong>
                      <span className="queuePath">{item.pathLabel}</span>
                      <div className="queueMeta">
                        <span>{item.detection?.faces?.length ?? 0} 张脸</span>
                        <span>{selectedCount ? `${selectedCount} 个已选` : "未选"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="emptyQueue">
                <strong>还没有图片</strong>
                <p>单张模式可直接选图，批量模式可直接选择整个文件夹。</p>
              </div>
            )}
          </div>
        </aside>

        <section className="canvasPane">
          <div className="paneHeader">
            <div>
              <p className="sectionEyebrow">Review</p>
              <h2>{activeItem?.name || "当前预览"}</h2>
            </div>
            <div className="statusStack">
              {activeItem ? (
                <span className={`statusBadge ${STATUS_META[activeItem.status].tone}`}>
                  {STATUS_META[activeItem.status].label}
                </span>
              ) : null}
              <span className="mutedLine">{currentPrompt}</span>
            </div>
          </div>

          {activeItem ? (
            <div className="stagePanel">
              <div className="stageCanvas">
                <img alt={activeItem.name} className="stageImage" src={activeItem.previewUrl} />
                {activeItem.detection?.faces?.map((face, order) => {
                  const keepSelected = tool === "keep" && face.index === activeItem.keepFaceId;
                  const eraseSelected = tool === "erase" && activeItem.eraseFaceIds.includes(face.index);
                  const boxWidth =
                    ((face.box.x2 - face.box.x1) / activeItem.detection.image.width) * 100;
                  const boxHeight =
                    ((face.box.y2 - face.box.y1) / activeItem.detection.image.height) * 100;
                  const boxLeft = (face.box.x1 / activeItem.detection.image.width) * 100;
                  const boxTop = (face.box.y1 / activeItem.detection.image.height) * 100;

                  return (
                    <button
                      className={
                        keepSelected
                          ? "faceBox keepSelected"
                          : eraseSelected
                            ? "faceBox eraseSelected"
                            : "faceBox"
                      }
                      key={face.index}
                      onClick={() => selectFace(face.index)}
                      style={{
                        left: `${boxLeft}%`,
                        top: `${boxTop}%`,
                        width: `${boxWidth}%`,
                        height: `${boxHeight}%`
                      }}
                      type="button"
                    >
                      <span>{order + 1}</span>
                    </button>
                  );
                })}
              </div>

              <div className="stageToolbar">
                <button className="actionButton subtle" onClick={() => detectItem(activeItem.localId, true)} type="button">
                  重新检测
                </button>
                <button
                  className="actionButton primary"
                  disabled={saveDisabled}
                  onClick={() => saveCurrentItem(activeItem.localId)}
                  type="button"
                >
                  {activeItem?.status === "processing" ? "处理中..." : mode === "batch" ? "保存" : "生成结果"}
                </button>
                {mode === "batch" ? (
                  <button className="actionButton" onClick={goNextItem} type="button">
                    下一张
                  </button>
                ) : null}
                <button
                  className="actionButton subtle"
                  disabled={!activeItem || ["processed", "skipped"].includes(activeItem.status)}
                  onClick={skipActiveItem}
                  type="button"
                >
                  跳过这张
                </button>
              </div>
            </div>
          ) : (
            <div className="canvasEmpty">
              <strong>像看邮件一样逐张处理图片。</strong>
              <p>左边导入图片或文件夹，系统会把它们组织成一个可审阅的工作队列。</p>
            </div>
          )}
        </section>

        <aside className="inspectorPane">
          <div className="railPanel">
            <div className="listPanelHeader">
              <div>
                <p className="sectionEyebrow">Faces</p>
                <h2>候选人脸</h2>
              </div>
              {activeItem?.detection?.faces?.length ? (
                <span className="countBadge">{activeItem.detection.faces.length}</span>
              ) : null}
            </div>

            {activeItem?.detection?.faces?.length ? (
              <div className="faceList">
                {activeItem.detection.faces.map((face, order) => {
                  const keepSelected = tool === "keep" && face.index === activeItem.keepFaceId;
                  const eraseSelected = tool === "erase" && activeItem.eraseFaceIds.includes(face.index);
                  return (
                    <button
                      className={
                        keepSelected
                          ? "faceListCard keepSelected"
                          : eraseSelected
                            ? "faceListCard eraseSelected"
                            : "faceListCard"
                      }
                      key={face.index}
                      onClick={() => selectFace(face.index)}
                      type="button"
                    >
                      <img alt={`Face ${order + 1}`} src={face.previewDataUrl} />
                      <div>
                        <strong>{keepSelected ? "保留目标" : eraseSelected ? "抹除目标" : `候选 ${order + 1}`}</strong>
                        <span>置信度 {formatConfidence(face.confidence)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="miniEmpty">检测完成后，这里会列出所有候选人脸。</div>
            )}
          </div>

          <div className="railPanel">
            <div className="listPanelHeader">
              <div>
                <p className="sectionEyebrow">Output</p>
                <h2>结果预览</h2>
              </div>
            </div>

            {activeItem?.result?.crop ? (
              <div className="resultStack">
                <div className="resultCard">
                  <div className="resultCardHeader">
                    <strong>裁剪结果</strong>
                    <a
                      className="downloadLink"
                      download={downloadName(activeItem, "crop")}
                      href={activeItem.result.crop.dataUrl}
                    >
                      下载
                    </a>
                  </div>
                  <img alt="Crop result" src={activeItem.result.crop.dataUrl} />
                </div>

                {activeItem.result.painted ? (
                  <div className="resultCard">
                    <div className="resultCardHeader">
                      <strong>涂抹结果</strong>
                      <a
                        className="downloadLink"
                        download={downloadName(activeItem, "painted")}
                        href={activeItem.result.painted.dataUrl}
                      >
                        下载
                      </a>
                    </div>
                    <img alt="Painted result" src={activeItem.result.painted.dataUrl} />
                  </div>
                ) : null}
              </div>
            ) : activeItem?.result?.painted ? (
              <div className="resultStack">
                <div className="resultCard">
                  <div className="resultCardHeader">
                    <strong>涂抹结果</strong>
                    <a
                      className="downloadLink"
                      download={downloadName(activeItem, "painted")}
                      href={activeItem.result.painted.dataUrl}
                    >
                      下载
                    </a>
                  </div>
                  <img alt="Painted result" src={activeItem.result.painted.dataUrl} />
                </div>
              </div>
            ) : (
              <div className="miniEmpty">当前图片处理完成后，结果会出现在这里。</div>
            )}

            {globalError ? <p className="errorBanner">{globalError}</p> : null}
          </div>
        </aside>
      </section>

      <input
        accept="image/*"
        hidden
        onChange={(event) => {
          installQueue(event.target.files, "single");
          event.target.value = "";
        }}
        ref={singleInputRef}
        type="file"
      />
      <input
        accept="image/*"
        hidden
        multiple
        onChange={(event) => {
          installQueue(event.target.files, "batch");
          event.target.value = "";
        }}
        ref={folderInputRef}
        type="file"
      />
    </main>
  );
}
