# Documentation

This directory contains project documentation files.

## LaTeX Files

### Informe_2_Arquitectura_de_Software.tex

This is the LaTeX source file for "Informe 2 Arquitectura de Software". It was converted from the original PDF file `Informe 2 Arquitectura de Software.pdf`.

#### Compiling the LaTeX file

To compile the LaTeX file and generate a PDF, you need to have a LaTeX distribution installed (e.g., TeX Live, MiKTeX).

```bash
# Compile twice to ensure proper table of contents generation
pdflatex Informe_2_Arquitectura_de_Software.tex
pdflatex Informe_2_Arquitectura_de_Software.tex
```

The generated PDF will be named `Informe_2_Arquitectura_de_Software.pdf`.

#### Required LaTeX packages

The document uses the following LaTeX packages:
- inputenc (UTF-8 encoding)
- babel (Spanish language support)
- geometry (page layout)
- enumitem (enhanced lists)
- titlesec (section formatting)
- graphicx (image support)
- hyperref (hyperlinks and PDF metadata)
- fancyhdr (custom headers/footers)
- parskip (paragraph spacing)

#### Document structure

The document includes:
- Title page with team information
- Table of contents
- System description
- Expected objectives
- User profiles
- Functional and non-functional requirements
- Data model and persistence
- System architecture
- Communication interfaces (APIs)

#### Notes

- The original PDF contained images in the Anexo section. These are not included in the LaTeX version but a placeholder is provided for adding them if needed.
- Auxiliary files (`.aux`, `.log`, `.out`, `.toc`) are generated during compilation and are ignored by git.
