document.addEventListener("DOMContentLoaded", () => {
  const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
  const sections = navLinks
    .map(a => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  const setActive = (id) => {
    navLinks.forEach(a => {
      const isMatch = a.getAttribute("href") === `#${id}`;
      if (isMatch) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  };

  // Set on load (hash or first section)
  const initial = location.hash ? location.hash.slice(1) : (sections[0]?.id || "");
  if (initial) setActive(initial);

  // Observe sections
  const observer = new IntersectionObserver((entries) => {
    // Pick the section most visible
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (visible?.target?.id) setActive(visible.target.id);
  }, {
    root: null,
    threshold: [0.2, 0.35, 0.5, 0.65],
    // accounts for sticky header
    rootMargin: "-80px 0px -60% 0px"
  });

  sections.forEach(sec => observer.observe(sec));

  // If user clicks nav, update immediately (nice UX)
  navLinks.forEach(a => {
    a.addEventListener("click", () => {
      const id = a.getAttribute("href").slice(1);
      setActive(id);
    });
  });
});
