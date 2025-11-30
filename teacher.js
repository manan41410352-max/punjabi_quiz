// Teacher / Admin dashboard logic for Kavita Quiz
// Reads results from localStorage key: "quizResults"
// Each entry should look like resultObj from quiz.html:
// {
//   studentName, studentRoll, classId, chapterId, chapterName,
//   score, totalQuestions, totalTimeSeconds
// }

(function () {
  const STORAGE_KEY = "quizResults";

  // 1. Load results
  function loadResults() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (e) {
      console.error("Error reading quizResults from localStorage", e);
      return [];
    }
  }

  // 2. Helper to resolve class/chapters from CLASSES
  function getClassNameById(classIdOrKey) {
    if (typeof CLASSES === "undefined") return classIdOrKey || "";
    // classIdOrKey may be "CLASS_7" or "class_7"
    if (CLASSES[classIdOrKey]) {
      return CLASSES[classIdOrKey].name || classIdOrKey;
    }
    const found = Object.keys(CLASSES).find(
      (key) => CLASSES[key].id === classIdOrKey
    );
    return found && CLASSES[found] ? CLASSES[found].name : classIdOrKey || "";
  }

  function getChapterName(classIdOrKey, chapterId, fallback) {
    if (typeof CLASSES === "undefined") return fallback || chapterId || "";
    let cls = null;
    if (CLASSES[classIdOrKey]) {
      cls = CLASSES[classIdOrKey];
    } else {
      const foundKey = Object.keys(CLASSES).find(
        (key) => CLASSES[key].id === classIdOrKey
      );
      if (foundKey) cls = CLASSES[foundKey];
    }
    if (!cls || !Array.isArray(cls.chapters)) return fallback || chapterId || "";
    const chapter = cls.chapters.find((ch) => ch.id === chapterId);
    return (chapter && chapter.name) || fallback || chapterId || "";
  }

  const results = loadResults();

  // DOM references
  const filterClassEl = document.getElementById("filter-class");
  const filterStudentEl = document.getElementById("filter-student");
  const filterChapterEl = document.getElementById("filter-chapter");
  const resetBtn = document.getElementById("btn-reset-filters");
  const exportBtn = document.getElementById("btn-export");
  const tbody = document.getElementById("results-table-body");
  const noDataMsg = document.getElementById("no-data-msg");

  const statTotalQuizzesEl = document.getElementById("stat-total-quizzes");
  const statAvgScoreEl = document.getElementById("stat-avg-score");
  const statStrongTopicEl = document.getElementById("stat-strong-topic");
  const statWeakTopicEl = document.getElementById("stat-weak-topic");

  const heatmapContainer = document.getElementById("heatmap-container");

  let barChart = null;

  // Build unique lists for filters
  const uniqueClasses = Array.from(
    new Set(results.map((r) => r.classId).filter(Boolean))
  );
  const uniqueStudents = Array.from(
    new Set(results.map((r) => `${r.studentName}|||${r.studentRoll}`))
  );
  const uniqueChapters = Array.from(
    new Set(results.map((r) => r.chapterId).filter(Boolean))
  );

  function initFilters() {
    // Classes
    uniqueClasses.forEach((clsId) => {
      const opt = document.createElement("option");
      opt.value = clsId;
      opt.textContent = getClassNameById(clsId);
      filterClassEl.appendChild(opt);
    });

    // Students
    uniqueStudents.forEach((key) => {
      const [name, roll] = key.split("|||");
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `${name} (${roll})`;
      filterStudentEl.appendChild(opt);
    });

    // Chapters
    uniqueChapters.forEach((chId) => {
      const opt = document.createElement("option");
      opt.value = chId;
      // Try to fetch name using first matching result entry
      const any = results.find((r) => r.chapterId === chId);
      opt.textContent =
        (any && (any.chapterName || getChapterName(any.classId, chId))) ||
        chId;
      filterChapterEl.appendChild(opt);
    });
  }

  function applyFilters() {
    return results.filter((r) => {
      const classFilter = filterClassEl.value;
      const studentFilter = filterStudentEl.value;
      const chapterFilter = filterChapterEl.value;

      if (classFilter && r.classId !== classFilter) return false;
      if (chapterFilter && r.chapterId !== chapterFilter) return false;

      if (studentFilter) {
        const key = `${r.studentName}|||${r.studentRoll}`;
        if (key !== studentFilter) return false;
      }
      return true;
    });
  }

  function renderTable(filtered) {
    tbody.innerHTML = "";

    if (!filtered.length) {
      noDataMsg.classList.remove("hidden");
      return;
    }
    noDataMsg.classList.add("hidden");

    filtered.forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = "odd:bg-white even:bg-slate-50";

      const percent = r.totalQuestions
        ? (r.score / r.totalQuestions) * 100
        : 0;

      tr.innerHTML = `
        <td class="px-3 py-2 border-b border-slate-100 text-left">
          ${getClassNameById(r.classId)}
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-left font-semibold">
          ${r.studentName || ""}
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-left">
          ${r.studentRoll || ""}
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-left">
          ${r.chapterName || getChapterName(r.classId, r.chapterId, r.chapterId)}
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-right">
          ${r.score} / ${r.totalQuestions}
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-right">
          ${percent.toFixed(0)}%
        </td>
        <td class="px-3 py-2 border-b border-slate-100 text-right">
          ${r.totalTimeSeconds != null ? r.totalTimeSeconds : ""}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function computeSummary(filtered) {
    const totalQuizzes = filtered.length;
    statTotalQuizzesEl.textContent = totalQuizzes;

    if (!filtered.length) {
      statAvgScoreEl.textContent = "0";
      statStrongTopicEl.textContent = "—";
      statWeakTopicEl.textContent = "—";
      return;
    }

    let sumPerc = 0;
    filtered.forEach((r) => {
      const p = r.totalQuestions ? (r.score / r.totalQuestions) * 100 : 0;
      sumPerc += p;
    });
    const avg = sumPerc / filtered.length;
    statAvgScoreEl.textContent = avg.toFixed(0);

    // Topic-wise
    const topicStats = {}; // key: chapterId
    filtered.forEach((r) => {
      if (!r.chapterId) return;
      const key = r.chapterId;
      if (!topicStats[key]) {
        topicStats[key] = { sumPerc: 0, count: 0, name: r.chapterName };
      }
      const p = r.totalQuestions ? (r.score / r.totalQuestions) * 100 : 0;
      topicStats[key].sumPerc += p;
      topicStats[key].count += 1;
    });

    let strongTopic = null;
    let weakTopic = null;

    Object.entries(topicStats).forEach(([chId, obj]) => {
      const avgP = obj.sumPerc / obj.count;
      const any = filtered.find((r) => r.chapterId === chId);
      const name =
        (any && (any.chapterName || getChapterName(any.classId, chId))) || chId;

      if (!strongTopic || avgP > strongTopic.avg) {
        strongTopic = { id: chId, name, avg: avgP };
      }
      if (!weakTopic || avgP < weakTopic.avg) {
        weakTopic = { id: chId, name, avg: avgP };
      }
    });

    statStrongTopicEl.textContent = strongTopic
      ? `${strongTopic.name} (${strongTopic.avg.toFixed(0)}%)`
      : "—";

    statWeakTopicEl.textContent = weakTopic
      ? `${weakTopic.name} (${weakTopic.avg.toFixed(0)}%)`
      : "—";

    // Update bar chart
    renderBarChart(topicStats);
    // Update heatmap with all results (global view, not only filtered)
    renderHeatmap(results);
  }

  function renderBarChart(topicStats) {
    const ctx = document.getElementById("chapterBarChart");
    if (!ctx) return;

    const labels = [];
    const data = [];

    Object.entries(topicStats).forEach(([chId, obj]) => {
      const any = results.find((r) => r.chapterId === chId);
      const name =
        (any && (any.chapterName || getChapterName(any.classId, chId))) || chId;
      labels.push(name);
      data.push(obj.sumPerc / obj.count);
    });

    if (barChart) {
      barChart.destroy();
    }

    barChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "ਔਸਤ ਪ੍ਰਤੀਸ਼ਤ",
            data,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: (val) => `${val}%`,
            },
          },
        },
      },
    });
  }

  function getHeatColorClass(percent) {
    if (percent >= 80) return "bg-emerald-500 text-white";
    if (percent >= 50) return "bg-amber-400 text-slate-900";
    if (percent >= 0) return "bg-rose-400 text-white";
    return "bg-slate-200 text-slate-700";
  }

  function renderHeatmap(allResults) {
    if (!heatmapContainer) return;

    if (!allResults.length) {
      heatmapContainer.innerHTML =
        '<p class="text-xs text-slate-500">ਕੋਈ ਡਾਟਾ ਨਹੀਂ।</p>';
      return;
    }

    const classIds = Array.from(new Set(allResults.map((r) => r.classId)));
    const chapterIds = Array.from(new Set(allResults.map((r) => r.chapterId)));

    // Build average percent for each (class, chapter)
    const map = {}; // key: classId|chapterId
    allResults.forEach((r) => {
      const key = `${r.classId}|||${r.chapterId}`;
      if (!map[key]) map[key] = { sum: 0, count: 0 };
      const p = r.totalQuestions ? (r.score / r.totalQuestions) * 100 : 0;
      map[key].sum += p;
      map[key].count += 1;
    });

    const headerRow = [
      '<table class="min-w-full border-collapse text-[11px]"><thead><tr>',
      '<th class="border border-slate-200 px-2 py-1 bg-slate-50 text-left">ਜਮਾਤ \ ਪਾਠ</th>',
    ];

    chapterIds.forEach((chId) => {
      const any = allResults.find((r) => r.chapterId === chId);
      const name =
        (any && (any.chapterName || getChapterName(any.classId, chId))) || chId;
      headerRow.push(
        `<th class="border border-slate-200 px-2 py-1 bg-slate-50 text-center">${name}</th>`
      );
    });
    headerRow.push("</tr></thead><tbody>");
    const bodyRows = [];

    classIds.forEach((clsId) => {
      const row = [
        '<tr>',
        `<td class="border border-slate-200 px-2 py-1 bg-slate-50 font-semibold">${getClassNameById(
          clsId
        )}</td>`,
      ];
      chapterIds.forEach((chId) => {
        const key = `${clsId}|||${chId}`;
        const obj = map[key];
        if (!obj) {
          row.push(
            '<td class="border border-slate-200 px-2 py-1 text-center text-slate-300">—</td>'
          );
        } else {
          const avg = obj.sum / obj.count;
          const cls = getHeatColorClass(avg);
          row.push(
            `<td class="border border-slate-200 px-2 py-1 text-center"><div class="w-10 h-7 mx-auto rounded text-[10px] flex items-center justify-center ${cls}">${avg.toFixed(
              0
            )}%</div></td>`
          );
        }
      });
      row.push("</tr>");
      bodyRows.push(row.join(""));
    });

    const footer = "</tbody></table>";
    heatmapContainer.innerHTML =
      headerRow.join("") + bodyRows.join("") + footer;
  }

  function updateView() {
    const filtered = applyFilters();
    renderTable(filtered);
    computeSummary(filtered);
  }

  function exportCSV() {
    const filtered = applyFilters();
    if (!filtered.length) {
      alert("ਕੋਈ ਡਾਟਾ ਨਹੀਂ ਮਿਲਿਆ (No data to export).");
      return;
    }

    const header = [
      "Class",
      "Student Name",
      "Roll",
      "Chapter",
      "Score",
      "Total Questions",
      "Percent",
      "Total Time (s)",
    ];
    const rows = [header.join(",")];

    filtered.forEach((r) => {
      const percent = r.totalQuestions
        ? ((r.score / r.totalQuestions) * 100).toFixed(1)
        : "0";
      const row = [
        `"${getClassNameById(r.classId)}"`,
        `"${r.studentName || ""}"`,
        `"${r.studentRoll || ""}"`,
        `"${r.chapterName || getChapterName(r.classId, r.chapterId, r.chapterId)}"`,
        r.score,
        r.totalQuestions,
        percent,
        r.totalTimeSeconds != null ? r.totalTimeSeconds : "",
      ];
      rows.push(row.join(","));
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quiz_results_report.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Init
  initFilters();
  updateView();

  // Events
  filterClassEl.addEventListener("change", updateView);
  filterStudentEl.addEventListener("change", updateView);
  filterChapterEl.addEventListener("change", updateView);
  resetBtn.addEventListener("click", () => {
    filterClassEl.value = "";
    filterStudentEl.value = "";
    filterChapterEl.value = "";
    updateView();
  });
  exportBtn.addEventListener("click", exportCSV);
})();
