# Contribución

Flujo pequeño y reproducible para cambios en este repositorio.

## 1. Instalar dependencias

```bash
cd /home/javier/proyectos/meetings/transcriptor-firefox
npm install
pre-commit install   # recomendado si vas a commitear
```

Requisitos: Node.js ≥ 18, npm, Firefox 121+ para pruebas manuales, `pre-commit` para hooks.

## 2. Crear o modificar pruebas

- Preferí tests en `tests/` con `node:test` antes o junto al cambio de comportamiento.
- Usá dobles (`fake-port`, clientes falsos) en lugar de Meet real o host real.
- No escribas tests tautológicos ni desactives aserciones para forzar verde.

## 3. Ejecutar controles locales

```bash
npm run check
```

Equivalente a: `format:check` + `lint` + `validate:manifest` + `test:coverage` (umbral **99%** en `shared/` y `scripts/`).

Si formateás código:

```bash
npm run format
```

Hooks sobre archivos tocados:

```bash
pre-commit run --files ruta/a/archivo.js otra.md
```

## 4. Revisar el diff

```bash
git diff
git diff --check
```

Verificá que no se hayan colado secretos, cambios al repo Python hermano, ni ampliaciones de permisos injustificadas.

## 5. Verificar el estado de Git

```bash
git status
```

Asegurate de incluir docs (`AGENTS.md`, `TESTING.md`, etc.) cuando el cambio altere arquitectura, seguridad o el flujo de calidad.

## 6. Commit solo con pedido explícito

No crees commits ni hagas push salvo que el mantenedor / usuario lo pida explícitamente.

Cuando se solicite un commit, el mensaje debe explicar el **porqué**, y los hooks de `pre-commit` deben poder pasar sin `--no-verify`.

## Reglas adicionales

- No modifiques `/home/javier/proyectos/meetings/transcriptor` desde tareas de este repo.
- No debilites ESLint, Prettier, tests o hooks para “hacer pasar” un cambio.
- No declares verificaciones no ejecutadas.
- Mantené compatibilidad Firefox (`browser.*`, `background.page`, ID fijo).
