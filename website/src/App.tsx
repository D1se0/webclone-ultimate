import { BackToTop, Footer, Nav } from './components/Nav';
import { Hero, HookStrip, RepoBanner } from './components/Hero';
import { CloneLab } from './components/Lab';
import { Capabilities, CtaBand, Examples, Pipeline, ZipAnatomy } from './components/Sections';
import { Compatibility, Docs, Faq, Trust } from './components/Docs';
import { useReveal, useTheme } from './hooks';

export default function App() {
  const { theme, toggle } = useTheme();
  useReveal();

  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <Nav theme={theme} onToggleTheme={toggle} />
      <main id="contenido">
        <Hero />
        <HookStrip />
        <CloneLab />
        <Capabilities />
        <Pipeline />
        <RepoBanner />
        <Examples />
        <ZipAnatomy />
        <Docs />
        <Trust />
        <Compatibility />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
      <BackToTop />
    </>
  );
}
