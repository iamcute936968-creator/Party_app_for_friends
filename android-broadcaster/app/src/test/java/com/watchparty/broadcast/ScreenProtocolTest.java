package com.watchparty.broadcast;

import org.junit.Test;
import java.util.Map;
import static org.junit.Assert.*;

public class ScreenProtocolTest {
    @Test public void permitsColdTransactionRetryButNeverClearsAnotherOwnerOrSession() {
        assertTrue(ScreenProtocol.canClearShare(null,"uid","session"));
        var share=Map.of("ownerUid","uid","id","session");
        assertTrue(ScreenProtocol.canClearShare(share,"uid","session"));
        assertFalse(ScreenProtocol.canClearShare(share,"other","session"));
        assertFalse(ScreenProtocol.canClearShare(share,"uid","old"));
    }
    @Test public void preservesFirebaseDenseNumericKeysAndSparsePositions() {
        assertEquals("phone-uid",ScreenProtocol.map(java.util.Arrays.asList("host-uid",null,"phone-uid")).get("2"));
        assertTrue(ScreenProtocol.online(Map.of("connections",java.util.Arrays.asList(null,true))));
    }
    @Test public void recognizesOnlyTheActiveVersionTwoMarkerAndItsOwner() {
        var share = Map.of("version", 2L, "id", "current", "owner", "Phone", "ownerUid", "uid", "connections", Map.of("current", true));
        assertTrue(ScreenProtocol.activeShare(share));
        assertTrue(ScreenProtocol.owns(share, "uid", "current"));
        assertFalse(ScreenProtocol.owns(share, "other", "current"));
        assertFalse(ScreenProtocol.activeShare(Map.of("version", 2L, "id", "old", "connections", Map.of("current", true))));
    }
    @Test public void rejectsCrossViewerStaleSessionAndStaleConnectionSignals() {
        var signal = Map.of("from", "Viewer", "sessionId", "share", "connectionId", "peer");
        assertTrue(ScreenProtocol.matches(signal, "Viewer", "share", "peer"));
        assertFalse(ScreenProtocol.matches(signal, "Intruder", "share", "peer"));
        assertFalse(ScreenProtocol.matches(signal, "Viewer", "old", "peer"));
        assertFalse(ScreenProtocol.matches(signal, "Viewer", "share", "old"));
        assertFalse(ScreenProtocol.matches(signal, "Viewer", "share", "peer", false));
        assertFalse(ScreenProtocol.online(Map.of("connections", Map.of())));
        assertTrue(ScreenProtocol.online(Map.of("connections", Map.of("session", true))));
    }
}
