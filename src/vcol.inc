; Generated (the plot_vert column): one row per render row, top down, the
; step to the next row folded in - the screen thirds fall at render rows
; 47 and 111 (the render area starts at screen row 16).  A vertical enters
; at its top row's plot (VPE_LO/VPE_HI planes by row) and a RET patched
; over the byte after its bottom row's plot (the entry + 3) ends it.  HL = the top byte, C = the mask,
; DE = $F920 (a cell step: L + 32, H - 7 in one add; the thirds have their own).
VP_COL:
vpr0:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx0:          inc     h
vpr1:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx1:          inc     h
vpr2:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx2:          inc     h
vpr3:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx3:          inc     h
vpr4:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx4:          inc     h
vpr5:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx5:          inc     h
vpr6:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx6:          inc     h
vpr7:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx7:           add     hl,de                   ; the next cell: L + 32, H - 7
vpr8:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx8:          inc     h
vpr9:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx9:          inc     h
vpr10:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx10:          inc     h
vpr11:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx11:          inc     h
vpr12:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx12:          inc     h
vpr13:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx13:          inc     h
vpr14:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx14:          inc     h
vpr15:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx15:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr16:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx16:          inc     h
vpr17:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx17:          inc     h
vpr18:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx18:          inc     h
vpr19:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx19:          inc     h
vpr20:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx20:          inc     h
vpr21:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx21:          inc     h
vpr22:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx22:          inc     h
vpr23:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx23:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr24:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx24:          inc     h
vpr25:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx25:          inc     h
vpr26:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx26:          inc     h
vpr27:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx27:          inc     h
vpr28:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx28:          inc     h
vpr29:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx29:          inc     h
vpr30:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx30:          inc     h
vpr31:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx31:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr32:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx32:          inc     h
vpr33:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx33:          inc     h
vpr34:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx34:          inc     h
vpr35:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx35:          inc     h
vpr36:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx36:          inc     h
vpr37:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx37:          inc     h
vpr38:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx38:          inc     h
vpr39:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx39:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr40:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx40:          inc     h
vpr41:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx41:          inc     h
vpr42:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx42:          inc     h
vpr43:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx43:          inc     h
vpr44:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx44:          inc     h
vpr45:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx45:          inc     h
vpr46:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx46:          inc     h
vpr47:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx47:          ld      a,l
                add     a,32
                ld      l,a
                inc     h               ; the next third (render row + 16)
vpr48:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx48:          inc     h
vpr49:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx49:          inc     h
vpr50:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx50:          inc     h
vpr51:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx51:          inc     h
vpr52:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx52:          inc     h
vpr53:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx53:          inc     h
vpr54:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx54:          inc     h
vpr55:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx55:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr56:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx56:          inc     h
vpr57:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx57:          inc     h
vpr58:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx58:          inc     h
vpr59:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx59:          inc     h
vpr60:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx60:          inc     h
vpr61:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx61:          inc     h
vpr62:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx62:          inc     h
vpr63:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx63:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr64:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx64:          inc     h
vpr65:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx65:          inc     h
vpr66:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx66:          inc     h
vpr67:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx67:          inc     h
vpr68:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx68:          inc     h
vpr69:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx69:          inc     h
vpr70:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx70:          inc     h
vpr71:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx71:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr72:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx72:          inc     h
vpr73:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx73:          inc     h
vpr74:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx74:          inc     h
vpr75:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx75:          inc     h
vpr76:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx76:          inc     h
vpr77:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx77:          inc     h
vpr78:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx78:          inc     h
vpr79:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx79:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr80:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx80:          inc     h
vpr81:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx81:          inc     h
vpr82:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx82:          inc     h
vpr83:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx83:          inc     h
vpr84:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx84:          inc     h
vpr85:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx85:          inc     h
vpr86:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx86:          inc     h
vpr87:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx87:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr88:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx88:          inc     h
vpr89:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx89:          inc     h
vpr90:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx90:          inc     h
vpr91:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx91:          inc     h
vpr92:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx92:          inc     h
vpr93:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx93:          inc     h
vpr94:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx94:          inc     h
vpr95:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx95:          add     hl,de                   ; the next cell: L + 32, H - 7
vpr96:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx96:          inc     h
vpr97:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx97:          inc     h
vpr98:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx98:          inc     h
vpr99:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx99:          inc     h
vpr100:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx100:          inc     h
vpr101:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx101:          inc     h
vpr102:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx102:          inc     h
vpr103:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx103:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr104:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx104:          inc     h
vpr105:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx105:          inc     h
vpr106:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx106:          inc     h
vpr107:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx107:          inc     h
vpr108:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx108:          inc     h
vpr109:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx109:          inc     h
vpr110:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx110:          inc     h
vpr111:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx111:          ld      a,l
                add     a,32
                ld      l,a
                inc     h               ; the next third (render row + 16)
vpr112:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx112:          inc     h
vpr113:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx113:          inc     h
vpr114:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx114:          inc     h
vpr115:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx115:          inc     h
vpr116:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx116:          inc     h
vpr117:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx117:          inc     h
vpr118:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx118:          inc     h
vpr119:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx119:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr120:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx120:          inc     h
vpr121:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx121:          inc     h
vpr122:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx122:          inc     h
vpr123:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx123:          inc     h
vpr124:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx124:          inc     h
vpr125:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx125:          inc     h
vpr126:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx126:          inc     h
vpr127:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx127:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr128:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx128:          inc     h
vpr129:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx129:          inc     h
vpr130:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx130:          inc     h
vpr131:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx131:          inc     h
vpr132:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx132:          inc     h
vpr133:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx133:          inc     h
vpr134:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx134:          inc     h
vpr135:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx135:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr136:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx136:          inc     h
vpr137:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx137:          inc     h
vpr138:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx138:          inc     h
vpr139:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx139:          inc     h
vpr140:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx140:          inc     h
vpr141:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx141:          inc     h
vpr142:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx142:          inc     h
vpr143:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx143:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr144:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx144:          inc     h
vpr145:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx145:          inc     h
vpr146:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx146:          inc     h
vpr147:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx147:          inc     h
vpr148:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx148:          inc     h
vpr149:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx149:          inc     h
vpr150:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx150:          inc     h
vpr151:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx151:         add     hl,de                   ; the next cell: L + 32, H - 7
vpr152:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx152:          inc     h
vpr153:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx153:          inc     h
vpr154:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx154:          inc     h
vpr155:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx155:          inc     h
vpr156:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx156:          inc     h
vpr157:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx157:          inc     h
vpr158:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx158:          inc     h
vpr159:          ld      a,(hl)
                or      c
                ld      (hl),a
vpx159:          ret
                ALIGN   256
VPE_LO:
                DB      vpr0&255,vpr1&255,vpr2&255,vpr3&255,vpr4&255,vpr5&255,vpr6&255,vpr7&255
                DB      vpr8&255,vpr9&255,vpr10&255,vpr11&255,vpr12&255,vpr13&255,vpr14&255,vpr15&255
                DB      vpr16&255,vpr17&255,vpr18&255,vpr19&255,vpr20&255,vpr21&255,vpr22&255,vpr23&255
                DB      vpr24&255,vpr25&255,vpr26&255,vpr27&255,vpr28&255,vpr29&255,vpr30&255,vpr31&255
                DB      vpr32&255,vpr33&255,vpr34&255,vpr35&255,vpr36&255,vpr37&255,vpr38&255,vpr39&255
                DB      vpr40&255,vpr41&255,vpr42&255,vpr43&255,vpr44&255,vpr45&255,vpr46&255,vpr47&255
                DB      vpr48&255,vpr49&255,vpr50&255,vpr51&255,vpr52&255,vpr53&255,vpr54&255,vpr55&255
                DB      vpr56&255,vpr57&255,vpr58&255,vpr59&255,vpr60&255,vpr61&255,vpr62&255,vpr63&255
                DB      vpr64&255,vpr65&255,vpr66&255,vpr67&255,vpr68&255,vpr69&255,vpr70&255,vpr71&255
                DB      vpr72&255,vpr73&255,vpr74&255,vpr75&255,vpr76&255,vpr77&255,vpr78&255,vpr79&255
                DB      vpr80&255,vpr81&255,vpr82&255,vpr83&255,vpr84&255,vpr85&255,vpr86&255,vpr87&255
                DB      vpr88&255,vpr89&255,vpr90&255,vpr91&255,vpr92&255,vpr93&255,vpr94&255,vpr95&255
                DB      vpr96&255,vpr97&255,vpr98&255,vpr99&255,vpr100&255,vpr101&255,vpr102&255,vpr103&255
                DB      vpr104&255,vpr105&255,vpr106&255,vpr107&255,vpr108&255,vpr109&255,vpr110&255,vpr111&255
                DB      vpr112&255,vpr113&255,vpr114&255,vpr115&255,vpr116&255,vpr117&255,vpr118&255,vpr119&255
                DB      vpr120&255,vpr121&255,vpr122&255,vpr123&255,vpr124&255,vpr125&255,vpr126&255,vpr127&255
                DB      vpr128&255,vpr129&255,vpr130&255,vpr131&255,vpr132&255,vpr133&255,vpr134&255,vpr135&255
                DB      vpr136&255,vpr137&255,vpr138&255,vpr139&255,vpr140&255,vpr141&255,vpr142&255,vpr143&255
                DB      vpr144&255,vpr145&255,vpr146&255,vpr147&255,vpr148&255,vpr149&255,vpr150&255,vpr151&255
                DB      vpr152&255,vpr153&255,vpr154&255,vpr155&255,vpr156&255,vpr157&255,vpr158&255,vpr159&255
                DB      vpx159&255              ; entry 160: the column's own ret
                DS      95, 0
VPE_HI:
                DB      vpr0>>8,vpr1>>8,vpr2>>8,vpr3>>8,vpr4>>8,vpr5>>8,vpr6>>8,vpr7>>8
                DB      vpr8>>8,vpr9>>8,vpr10>>8,vpr11>>8,vpr12>>8,vpr13>>8,vpr14>>8,vpr15>>8
                DB      vpr16>>8,vpr17>>8,vpr18>>8,vpr19>>8,vpr20>>8,vpr21>>8,vpr22>>8,vpr23>>8
                DB      vpr24>>8,vpr25>>8,vpr26>>8,vpr27>>8,vpr28>>8,vpr29>>8,vpr30>>8,vpr31>>8
                DB      vpr32>>8,vpr33>>8,vpr34>>8,vpr35>>8,vpr36>>8,vpr37>>8,vpr38>>8,vpr39>>8
                DB      vpr40>>8,vpr41>>8,vpr42>>8,vpr43>>8,vpr44>>8,vpr45>>8,vpr46>>8,vpr47>>8
                DB      vpr48>>8,vpr49>>8,vpr50>>8,vpr51>>8,vpr52>>8,vpr53>>8,vpr54>>8,vpr55>>8
                DB      vpr56>>8,vpr57>>8,vpr58>>8,vpr59>>8,vpr60>>8,vpr61>>8,vpr62>>8,vpr63>>8
                DB      vpr64>>8,vpr65>>8,vpr66>>8,vpr67>>8,vpr68>>8,vpr69>>8,vpr70>>8,vpr71>>8
                DB      vpr72>>8,vpr73>>8,vpr74>>8,vpr75>>8,vpr76>>8,vpr77>>8,vpr78>>8,vpr79>>8
                DB      vpr80>>8,vpr81>>8,vpr82>>8,vpr83>>8,vpr84>>8,vpr85>>8,vpr86>>8,vpr87>>8
                DB      vpr88>>8,vpr89>>8,vpr90>>8,vpr91>>8,vpr92>>8,vpr93>>8,vpr94>>8,vpr95>>8
                DB      vpr96>>8,vpr97>>8,vpr98>>8,vpr99>>8,vpr100>>8,vpr101>>8,vpr102>>8,vpr103>>8
                DB      vpr104>>8,vpr105>>8,vpr106>>8,vpr107>>8,vpr108>>8,vpr109>>8,vpr110>>8,vpr111>>8
                DB      vpr112>>8,vpr113>>8,vpr114>>8,vpr115>>8,vpr116>>8,vpr117>>8,vpr118>>8,vpr119>>8
                DB      vpr120>>8,vpr121>>8,vpr122>>8,vpr123>>8,vpr124>>8,vpr125>>8,vpr126>>8,vpr127>>8
                DB      vpr128>>8,vpr129>>8,vpr130>>8,vpr131>>8,vpr132>>8,vpr133>>8,vpr134>>8,vpr135>>8
                DB      vpr136>>8,vpr137>>8,vpr138>>8,vpr139>>8,vpr140>>8,vpr141>>8,vpr142>>8,vpr143>>8
                DB      vpr144>>8,vpr145>>8,vpr146>>8,vpr147>>8,vpr148>>8,vpr149>>8,vpr150>>8,vpr151>>8
                DB      vpr152>>8,vpr153>>8,vpr154>>8,vpr155>>8,vpr156>>8,vpr157>>8,vpr158>>8,vpr159>>8
                DB      vpx159>>8
