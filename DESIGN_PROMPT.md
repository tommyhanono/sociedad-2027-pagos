# UI Redesign Brief — Sociedad 2027 Pagos

## Qué es esto
PWA mobile-first (React + Vite + Tailwind) donde los papás de alumnos del colegio suben comprobantes de pago ACH. 3 pantallas: datos bancarios → formulario → confirmación.

**Deploy actual:** https://tommyhanono.github.io/sociedad-2027-pagos/
**Repo:** https://github.com/tommyhanono/sociedad-2027-pagos

---

## Paleta actual
| Token | Hex | Uso actual |
|-------|-----|-----------|
| Navy | `#1A3A6B` | Headers, botón submit, texto labels |
| Gold | `#F5A623` | Acento "2027", botón CTA pantalla 1 |
| Background | `#F0F4F8` | Fondo global |
| Success | `#22C55E` | Checkmark pantalla 3 |
| Error | `#EF4444` | Validaciones |

---

## Pantalla 1 — Datos bancarios (`PaymentInfo.jsx`)
**Problemas a mejorar:**
- La tarjeta navy se ve genérica/corporativa — darle más personalidad y calidez (esto es una promo escolar, Promo 2027)
- Agregar logo o ícono de "Promo 2027" / moneda / hucha (el concepto visual de la imagen de referencia es una alcancía con monedas)
- El texto "B"H" (Baruj HaShem) aparece en la imagen original del colegio — considerar agregarlo como pequeño detalle arriba a la derecha
- El botón "Ya pagué →" podría tener más personalidad — quizás con emoji 💸 o ícono
- Los datos bancarios podrían tener mayor jerarquía visual — el número de cuenta debería ser más grande y fácil de copiar

**Datos que se muestran:**
```
Beneficiario: Margie Hanono ó Esther Davarro
Banco: Credicorp Bank
Tipo: Cuenta de Ahorros
Cuenta: 4021-973-201
```

---

## Pantalla 2 — Formulario (`PaymentForm.jsx`)
**Problemas a mejorar:**
- Los inputs se ven muy genéricos — más redondeo, sombras suaves, focus ring con color gold
- El área de upload de foto podría tener ilustración más amigable o animación de hover
- El selector de mes podría ser un grid de chips clicables en lugar de un `<select>` nativo (más visual)
- El botón "Enviar comprobante" podría tener gradiente navy→azul más oscuro
- Falta separación visual entre campos — más breathing room
- El label "Nombre del janij/a" quizás "Nombre del alumno/a" es más universal (no todos conocen "janij")

**Campos:**
1. Nombre del janij/a (text)
2. Monto pagado (number con prefijo B/.)
3. Mes que cubre (select — meses del año actual)
4. Comprobante de pago (file upload, imagen)

---

## Pantalla 3 — Confirmación (`SuccessScreen.jsx`)
**Problemas a mejorar:**
- El checkmark animado es bueno pero el card de resumen se ve muy simple
- Agregar confetti o animación celebratoria leve (CSS only, no librería)
- El texto "Pendiente de revisión" podría tener un badge/pill de color ámbar en lugar de texto plano
- La miniatura del comprobante podría tener un borde redondeado más pronunciado y sombra

---

## Restricciones técnicas
- Solo CSS-in-JSX (style prop) + Tailwind CSS v4 — NO usar clases de Tailwind que no existan en v4
- NO agregar librerías externas (no framer-motion, no confetti-js, etc.)
- Animaciones: solo CSS keyframes (ya existe `fadeIn`, `checkDraw`, `circlePop` en `src/index.css`)
- Mobile-first — el max-width del contenedor es 440px
- Los colores deben mantenerse fieles a la identidad: navy `#1A3A6B` y gold `#F5A623`
- Los `import.meta.env.VITE_*` variables son las fuentes de verdad para los datos bancarios — no hardcodear

---

## Referencia visual
La imagen de referencia del colegio muestra:
- Tipografía bold/uppercase estilo pizarrón
- Una alcancía/hucha ilustrada con monedas cayendo
- "Promo 2027" escrito en la alcancía
- Colores cálidos (rosa/terracota para acentos, gris para fondos)
- "B"H" en la esquina superior derecha (abreviatura religiosa judía, del hebreo "Baruj HaShem")

**Tono:** cálido, escolar, de comunidad — no corporativo. Los papás deben sentir que es algo hecho por el colegio, no un banco.

---

## Archivos a editar
```
src/
  index.css              ← animaciones CSS
  components/
    PaymentInfo.jsx      ← pantalla 1
    PaymentForm.jsx      ← pantalla 2
    SuccessScreen.jsx    ← pantalla 3
  App.jsx                ← layout wrapper (min-h-svh, max-w-440)
```

## Qué NO cambiar
- La lógica de submit en `PaymentForm.jsx` (Supabase upload + insert)
- Las variables `VITE_*` del `.env`
- El `vite.config.js`
- La estructura de 3 pantallas en `App.jsx`
