// Add an animation to the header
gsap.from(".header", {
    opacity: 0,
    y: -50,
    duration: 1,
    delay: 0.5,
    ease: "power2.out",
  });
  
  gsap.from(".features li", {
    opacity: 0,
    y: 20,
    duration: 1,
    delay: 1,
    ease: "power2.out",
    stagger: 0.2,
  });
  
  const discordButton = document.getElementById("dscbtn");
  discordButton.addEventListener("mouseenter", () => {
    gsap.to(discordButton, {
      backgroundColor: "#6c3da3",
      scale: 1.05,
      duration: 0.2,
    });
  });
  
  discordButton.addEventListener("mouseleave", () => {
    gsap.to(discordButton, {
      backgroundColor: "var(--accent-color)",
      scale: 1,
      duration: 0.2,
    });
  });
  