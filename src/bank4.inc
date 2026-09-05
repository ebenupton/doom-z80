; ---------------------------------------------------------------------------
; Bank 4: the static objects - code at $C000 and, behind it, the packer's
; planes, the art templates and the workspace.  Written to its own file
; (BANK4_FILE, DEFINEd by the top level); sjasmplus appends the same bytes
; to the raw image as well, which every loader trims off again.
; ---------------------------------------------------------------------------
                OUTPUT  BANK4_FILE
                ORG     OBJ_CODE
                include "objects.z80"
                include "fsetup.z80"
                include "walk4.z80"
OBJ_CODE_END:
                DISPLAY "objects end at ", /H, OBJ_CODE_END
                ASSERT  OBJ_CODE_END <= OBJ_DATA
                DS      OBJ_DATA-$, 0
                INCBIN  "../build/objdata.bin"
                ASSERT  $ <= NODES4
                DS      NODES4-$, 0
                INCBIN  "../build/walkdata.bin"
                OUTEND
